<script lang="ts">
  import { onMount } from 'svelte';
  import { pageEnter, pageLeave, retirePage, activatePage } from './motion';

  let { initialEmail = '', onBack, onComplete }: {
    initialEmail?: string;
    onBack: () => void;
    onComplete: (email: string) => void;
  } = $props();
  let email = $state('');
  let password = $state('');
  let confirmation = $state('');
  let visible = $state(false);
  let busy = $state(false);
  let error = $state('');
  let field = $state<'email' | 'password' | 'confirmation' | null>(null);
  let mailFailed = $state(false);
  let registered = $state<User | null>(null);
  let emailInput = $state<HTMLInputElement>();
  let passwordInput = $state<HTMLInputElement>();
  let confirmationInput = $state<HTMLInputElement>();
  const messages: Record<string, string> = {
    EMAIL_EXISTS: '이미 가입된 이메일이에요. 로그인하거나 다른 이메일을 입력해주세요.',
    INVALID_INPUT: '이메일과 비밀번호를 확인해주세요. 비밀번호는 12~128자예요.',
    RATE_LIMITED: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.',
    SERVER_ERROR: '서버에 문제가 발생했어요. 잠시 후 다시 시도해주세요.',
    NETWORK_ERROR: '서버와 연결하지 못했어요. 가입되었을 수도 있으니 로그인을 먼저 시도해주세요.',
    TIMEOUT: '가입 결과를 확인하지 못했어요. 로그인을 먼저 시도하거나 잠시 후 다시 시도해주세요.',
    INVALID_RESPONSE: '가입 결과를 확인하지 못했어요. 로그인 화면에서 계정을 확인해주세요.',
  };
  onMount(() => { email = initialEmail; emailInput?.focus({ preventScroll: true }); });
  function clearError() { error = ''; field = null; }
  async function signup(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    clearError();
    if (!email.trim() || !emailInput?.validity.valid) { error = '올바른 이메일 주소를 입력해주세요.'; field = 'email'; emailInput?.focus(); return; }
    if (password.length < 12 || password.length > 128) { error = '비밀번호를 12~128자로 입력해주세요.'; field = 'password'; passwordInput?.focus(); return; }
    if (!confirmation || password !== confirmation) { error = '비밀번호가 일치하지 않아요. 다시 확인해주세요.'; field = 'confirmation'; confirmationInput?.focus(); return; }
    const api = window.marioNet;
    if (!api) { error = '데스크톱 앱에서 회원가입을 진행해주세요.'; return; }
    busy = true;
    try {
      const result = await api.signup({ email: email.trim(), password });
      if (result.ok) { registered = result.user; mailFailed = result.verificationEmailSent === false; password = ''; confirmation = ''; visible = false; }
      else error = messages[result.code] ?? '회원가입을 완료하지 못했어요. 잠시 후 다시 시도해주세요.';
    } catch { error = '가입 결과를 확인하지 못했어요. 로그인 화면에서 계정을 확인해주세요.'; }
    finally { busy = false; }
  }
</script>

<div class="page-stack">
{#if registered}
  <div class="page-view" in:pageEnter out:pageLeave onintrostart={activatePage} onoutrostart={retirePage}>
  <section class="success signup-success" aria-labelledby="signup-success-title" aria-live="polite">
    <span class="success-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-8" /></svg></span>
    <p class="eyebrow">WELCOME TO MARIONET</p>
    <h1 id="signup-success-title">가입을 환영해요!</h1>
    <p class="success-copy">MarioNet 계정이 만들어졌어요.<br />이제 내 PC들과 연결을 시작해보세요.</p>
    <div class="account"><span>가입한 이메일</span><strong>{registered.email}</strong></div>
    <p class="verification-note">{mailFailed ? '계정은 생성됐지만 인증 메일을 보내지 못했어요. 로그인 후 재발송해주세요.' : '이메일 인증 안내를 확인해주세요.'}<br />로그인은 바로 가능하며, PC 등록에는 이메일 인증이 필요해요.</p>
    <button class="login-button" type="button" onclick={() => registered && onComplete(registered.email)}>로그인하러 가기</button>
  </section>
  </div>
{:else}
  <div class="page-view" in:pageEnter out:pageLeave onintrostart={activatePage} onoutrostart={retirePage}>
  <button class="back-link" type="button" disabled={busy} onclick={onBack}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>로그인으로 돌아가기
  </button>
  <div class="intro signup-intro">
    <h1>마리오넷 회원가입</h1>
    <p>계정을 생성하고 내 pc들을 한곳에서 제어하세요!</p>
  </div>
  <form class="signup-form" onsubmit={signup} novalidate aria-busy={busy}>
    <div class="field-group">
      <label for="signup-email">이메일</label>
      <input bind:this={emailInput} bind:value={email} id="signup-email" name="email" type="email" autocomplete="username" placeholder="name@example.com" maxlength="254" required disabled={busy} aria-invalid={field === 'email'} aria-describedby={error ? 'signup-error' : undefined} oninput={clearError} spellcheck="false" autocapitalize="none" />
    </div>
    <div class="field-group">
      <label for="signup-password">비밀번호</label>
      <input bind:this={passwordInput} bind:value={password} id="signup-password" name="password" type={visible ? 'text' : 'password'} autocomplete="new-password" placeholder="12자 이상 입력해주세요" maxlength="128" required disabled={busy} aria-invalid={field === 'password'} aria-describedby={error ? 'signup-error password-help' : 'password-help'} oninput={clearError} />
      <p id="password-help" class="password-help">12~128자로 설정해주세요.</p>
    </div>
    <div class="field-group">
      <label for="signup-confirmation">비밀번호 확인</label>
      <input bind:this={confirmationInput} bind:value={confirmation} id="signup-confirmation" name="password-confirmation" type={visible ? 'text' : 'password'} autocomplete="new-password" placeholder="비밀번호를 한 번 더 입력해주세요" maxlength="128" required disabled={busy} aria-invalid={field === 'confirmation'} aria-describedby={error ? 'signup-error' : undefined} oninput={clearError} />
    </div>
    <label class="show-password"><input type="checkbox" bind:checked={visible} disabled={busy} />비밀번호 표시</label>
    <div class="form-feedback">{#if error}<p id="signup-error" class="error" role="alert">{error}</p>{/if}</div>
    <button class="login-button" type="submit" disabled={busy}>
      {#if busy}<span class="spinner" aria-hidden="true"></span>가입 중…{:else}계정 만들기{/if}
    </button>
    <p class="signin-link">이미 계정이 있나요? <button type="button" disabled={busy} onclick={onBack}>로그인</button></p>
  </form>
  </div>
{/if}
</div>

