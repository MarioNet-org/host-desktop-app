<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Signup from './Signup.svelte';
  import HostHome from './HostHome.svelte';
  import VerificationWaiting from './VerificationWaiting.svelte';
  import { pageEnter, pageLeave, retirePage, activatePage } from './motion';
  import controller from '../../assets/brand/marionet-node.png';
  import wordmark from '../../assets/brand/marionet-host-wordmark.png';

  let email = $state('');
  let page = $state<'signin' | 'signup'>('signin');
  let direction = $state(1);
  let password = $state('');
  let visible = $state(false);
  let busy = $state(false);
  let capsLock = $state(false);
  let error = $state('');
  let field = $state<'email' | 'password' | null>(null);
  let session = $state<LoginSession | null>(null);
  let verifying = $state(false);
  let emailInput = $state<HTMLInputElement>();
  let passwordInput = $state<HTMLInputElement>();
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않아요. 다시 확인해주세요.',
    INVALID_INPUT: '이메일과 비밀번호를 확인해주세요. 비밀번호는 12~128자예요.',
    RATE_LIMITED: '로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요.',
    NETWORK_ERROR: '서버에 연결할 수 없어요. 네트워크 연결을 확인하고 다시 시도해주세요.',
    TIMEOUT: '서버 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.',
    SERVER_ERROR: '서버에 문제가 발생했어요. 잠시 후 다시 시도해주세요.',
    INVALID_RESPONSE: '로그인 응답을 확인할 수 없어요. 잠시 후 다시 시도해주세요.',
  };
  onMount(() => {
    const api = window.marioNet;
    if (!api) return;
    void api.getSession().then(value => { session = value; verifying = !!value && !value.user.emailVerified; }).catch(() => { error = '앱을 다시 실행해주세요.'; });
    return api.onExpired(() => { session = null; page = 'signin'; direction = -1; password = ''; error = '로그인 시간이 만료되었어요. 다시 로그인해주세요.'; });
  });
  function clearError() { error = ''; field = null; }
  function openSignup() {
    if (busy) return;
    password = ''; visible = false; capsLock = false; clearError(); direction = 1; page = 'signup';
  }
  async function backToSignin(registeredEmail?: string) {
    if (registeredEmail) email = registeredEmail;
    password = ''; visible = false; capsLock = false; clearError(); direction = -1; page = 'signin';
    await tick();
    if (registeredEmail) passwordInput?.focus({ preventScroll: true }); else emailInput?.focus({ preventScroll: true });
  }
  async function signin(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    clearError();
    if (!email.trim() || !emailInput?.validity.valid) { error = '올바른 이메일 주소를 입력해주세요.'; field = 'email'; emailInput?.focus(); return; }
    if (password.length < 12 || password.length > 128) { error = '비밀번호를 12~128자로 입력해주세요.'; field = 'password'; passwordInput?.focus(); return; }
    const api = window.marioNet;
    if (!api) { error = '데스크톱 앱에서 로그인해주세요.'; return; }
    busy = true;
    try {
      const result = await api.signin({ email: email.trim(), password });
      if (result.ok) { direction = 1; session = result; verifying = !result.user.emailVerified; password = ''; visible = false; }
      else { error = messages[result.code] ?? '로그인을 완료하지 못했어요. 다시 시도해주세요.'; }
    } catch { error = '로그인을 완료하지 못했어요. 앱을 다시 실행해주세요.'; }
    finally { busy = false; }
  }
</script>

<div class="desktop-shell">
  <header class="titlebar" aria-label="앱 창">
    <span class="window-title">MarioNet <span>Host</span></span>
    <div class="window-actions">
      <button aria-label="최소화" onclick={() => window.marioNet?.minimize()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10" /></svg></button>
      <button aria-label="최대화 또는 복원" onclick={() => window.marioNet?.maximize()}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx=".5" /></svg></button>
      <button class="close-window" aria-label="닫기" onclick={() => window.marioNet?.close()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button>
    </div>
  </header>

  <div class="app-pages">
  {#if session && verifying}
    <div class="page-view" in:pageEnter out:pageLeave onintrostart={activatePage} onoutrostart={retirePage}>
      <VerificationWaiting user={session.user} onVerified={user => { session = { ...session!, user }; verifying = false; }} onSignout={async () => { const result = await window.marioNet?.signout(); if (result?.ok) { session = null; verifying = false; } }} />
    </div>
  {:else if session}
    <div class="page-view" in:pageEnter out:pageLeave onintrostart={activatePage} onoutrostart={retirePage}>
      <HostHome user={session.user} onSignedOut={() => { session = null; page = 'signin'; direction = -1; password = ''; clearError(); }} />
    </div>
  {:else}
  <div class="page-view" in:pageEnter={{ direction }} out:pageLeave onintrostart={activatePage} onoutrostart={retirePage}>
  <main>
    <section class="brand" aria-label="MarioNet for host">
      <div class="brand-art">
        <img class="controller" src={controller} alt="MarioNet 호스트 PC" draggable="false" />
        <img class="wordmark" src={wordmark} alt="MarioNet for host" draggable="false" />
      </div>
    </section>

    <aside class="login-panel" class:signup-mode={page === 'signup'} aria-label={page === 'signup' ? '회원가입' : '계정 로그인'}>
      <div class="panel-content">
        {#if page === 'signup'}
          <div class="page-view" in:pageEnter={{ direction }} out:pageLeave onintrostart={activatePage} onoutrostart={retirePage}>
          <Signup initialEmail={email} onBack={() => backToSignin()} onComplete={backToSignin} />
          </div>
        {:else}
          <div class="page-view" in:pageEnter={{ direction }} out:pageLeave onintrostart={activatePage} onoutrostart={retirePage}>
          <div class="intro">
            <h1>로그인하고 이 PC를 연결하세요</h1>
            <p>내 PC를 안전하게 연결하는 시작.</p>
          </div>
          <form onsubmit={signin} novalidate aria-busy={busy}>
            <div class="field-group">
              <label for="email">이메일</label>
              <input bind:this={emailInput} bind:value={email} id="email" name="email" type="email" autocomplete="username" placeholder="name@example.com" maxlength="254" required disabled={busy} aria-invalid={field === 'email'} aria-describedby={error ? 'login-error' : undefined} oninput={clearError} spellcheck="false" autocapitalize="none" />
            </div>
            <div class="field-group">
              <label for="password">비밀번호</label>
              <div class="password-field">
                <input bind:this={passwordInput} bind:value={password} id="password" name="password" type={visible ? 'text' : 'password'} autocomplete="current-password" placeholder="비밀번호를 입력하세요" maxlength="128" required disabled={busy} aria-invalid={field === 'password'} aria-describedby={error ? 'login-error' : undefined} oninput={clearError} onkeydown={event => capsLock = event.getModifierState('CapsLock')} onkeyup={event => capsLock = event.getModifierState('CapsLock')} onblur={() => capsLock = false} />
                <button class="visibility" type="button" aria-label={visible ? '비밀번호 숨기기' : '비밀번호 표시'} aria-pressed={visible} disabled={busy} onclick={() => visible = !visible}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" />{#if visible}<path d="m3 3 18 18" />{/if}</svg>
                </button>
              </div>
            </div>
            <div class="form-feedback">
              {#if error}<p id="login-error" class="error" role="alert">{error}</p>
              {:else if capsLock}<p class="caps-lock" role="status">Caps Lock이 켜져 있어요.</p>{/if}
            </div>
            <button class="login-button" type="submit" disabled={busy}>
              {#if busy}<span class="spinner" aria-hidden="true"></span>로그인 중…{:else}로그인{/if}
            </button>
            <button class="signup-button" type="button" disabled={busy} onclick={openSignup}>회원가입</button>
          </form>
          </div>
        {/if}
      </div>
      <footer>하나의 계정으로, 모든 연결을.</footer>
    </aside>
  </main>
  </div>
  {/if}
  </div>
</div>


