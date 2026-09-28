<script lang="ts">
  import EmailVerification from './EmailVerification.svelte';
  import { onMount } from 'svelte';
  import nodeArt from '../../assets/brand/marionet-node.png';
  let { user, onSignedOut }: { user: User; onSignedOut: () => void } = $props();
  let host = $state<HostState | null>(null);
  let name = $state('');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  const resolutionOptions: { value: HostResolution; title: string; description: string }[] = [
    { value: 'standard', title: '16:9 · 권장', description: '1920 × 1080 이하로 화면을 잘라 전송합니다.' },
    { value: 'original', title: '원본 해상도', description: '현재 모니터의 비율과 해상도를 유지합니다.' },
    { value: 'saver', title: '16:9 · 절전', description: '1280 × 720으로 전송량을 줄입니다.' },
    { value: 'low', title: '16:9 · 저대역폭', description: '854 × 480으로 네트워크 사용량을 최소화합니다.' },
  ];
  const statuses: Record<string, string> = { offline: '연결 차단됨', online: '온라인 · 연결 대기', connecting: '서버 연결 중', reconnecting: '다시 연결하는 중', error: '연결 정보를 확인해주세요' };
  const errors: Record<string, string> = {
    EMAIL_NOT_VERIFIED: '이메일 인증 후 이 PC를 등록할 수 있어요. 가입 시 받은 인증 메일을 확인해주세요.',
    NODE_LIMIT: '등록 가능한 PC 수를 초과했어요.', INVALID_NAME: '호스트 이름을 1~80자로 입력해주세요.',
    STORAGE_UNAVAILABLE: '이 PC에서 안전한 저장소를 사용할 수 없어요.', STORAGE_ERROR: '호스트 정보를 저장하거나 읽지 못했어요. 앱을 다시 실행해주세요.',
    NODE_NOT_FOUND: '서버에서 이 호스트가 삭제되었어요.', UNAUTHORIZED: '로그인 시간이 만료되었어요. 다시 로그인해주세요.',
  };
  function apply(result: HostResult, updateName = false) {
    if (result.ok) { host = result.host; if (updateName) name = host.name; }
    else error = errors[result.code] || '요청을 완료하지 못했어요. 서버 연결을 확인하고 다시 시도해주세요.';
  }
  async function action(task: () => Promise<HostResult>, message = '') {
    if (busy) return;
    busy = true; error = ''; notice = '';
    try { const result = await task(); apply(result, true); if (result.ok) notice = message; }
    catch { error = '앱과 통신하지 못했어요. 다시 시도해주세요.'; }
    finally { busy = false; }
  }
  onMount(() => {
    let disposed = false;
    let polling = false;
    async function refresh(first = false) {
      if (polling || busy) return;
      polling = true;
      try { const result = await window.marioNet!.hostState(); if (!disposed) apply(result, first); }
      catch { if (!disposed) error = '호스트 정보를 불러오지 못했어요.'; }
      finally { polling = false; }
    }
    void refresh(true);
    const timer = setInterval(() => void refresh(), 2000);
    return () => { disposed = true; clearInterval(timer); };
  });
  async function signout() {
    busy = true;
    try { const result = await window.marioNet!.signout(); if (result.ok) onSignedOut(); else error = '잠시 후 다시 로그아웃해주세요.'; }
    catch { error = '로그아웃을 완료하지 못했어요.'; }
    finally { busy = false; }
  }
</script>

<section class="host-home" aria-label="호스트 관리">
  <div class="heading"><div><p class="eyebrow">MY HOST</p><h1>PC관리</h1><p>같은 계정의 MarioNet Client에서 이 PC를 확인할 수 있어요.</p></div><span class="status" class:online={host?.status === 'online'}><i></i>{host?.nodeId ? statuses[host.status] : 'PC 등록 대기'}</span></div>
  <div class="host-grid">
    <div class="settings">
      <EmailVerification {user} />
      <article>
        <div class="section-heading"><span class="number">01</span><div><h2>호스트 설정</h2><p>MarioNet Client에 표시할 이름을 정해주세요</p></div></div>
        <form onsubmit={event => { event.preventDefault(); void action(() => window.marioNet!.renameHost(name), '호스트 이름을 변경했어요.'); }}>
          <label for="hostname">호스트 이름</label><div class="name-row"><input id="hostname" bind:value={name} maxlength="80" disabled={busy || !host?.nodeId} placeholder="이 PC의 이름"/><button class="primary" disabled={busy || !host?.nodeId || !name.trim() || name.trim() === host.name}>변경</button></div>
        </form>
        {#if host && !host.nodeId}<div class="register"><p>이 계정에 PC를 등록하면 Client의 노드 목록에 표시돼요. 최초 등록에는 이메일 인증이 필요해요.</p><button class="primary" disabled={busy} onclick={() => action(() => window.marioNet!.registerHost(), 'PC를 등록했어요. 연결 허용을 켜면 온라인으로 표시돼요.')}>이 PC 등록</button></div>{/if}
        <div class="permission"><div><h3>연결 허용</h3><p>{host?.allowed ? '서버에 연결하여 이 PC의 상태를 알립니다.' : '연결을 끄면 Client에서 오프라인으로 표시됩니다.'}</p></div><button class="switch" class:enabled={host?.allowed} role="switch" aria-checked={host?.allowed ?? false} aria-label="연결 허용" disabled={busy || !host?.nodeId} onclick={() => action(() => window.marioNet!.allowHost(!host?.allowed))}><span></span></button></div>
        <div class="resolution"><div><h3>화면 해상도</h3><p>변경하면 현재 공유 화면이 새 해상도로 다시 시작됩니다.</p></div><select aria-label="화면 해상도" disabled={busy || !host?.nodeId} value={host?.resolution ?? 'standard'} onchange={event => action(() => window.marioNet!.setResolution((event.currentTarget as HTMLSelectElement).value as HostResolution), '화면 전송 해상도를 변경했어요.')}>{#each resolutionOptions as option}<option value={option.value}>{option.title}</option>{/each}</select></div>
        <p class="resolution-detail">{resolutionOptions.find(option => option.value === (host?.resolution ?? 'standard'))?.description}</p>
        <p class="development">이 PC의 화면은 읽기 전용으로 전송됩니다. 키보드·마우스 입력은 공유하지 않아요.</p>
      </article>
      <article>
        <div class="section-heading"><span class="number">02</span><div><h2>PC 정보</h2><p>현재 기기의 네트워크와 등록 정보예요.</p></div></div>
        <dl><div><dt>운영체제</dt><dd>{host?.platform === 'win32' ? 'Windows' : host?.platform === 'darwin' ? 'macOS' : host?.platform ?? '확인 중'}</dd></div><div><dt>로컬 IP 주소</dt><dd>{host?.addresses.join(' / ') || '연결된 네트워크 없음'}</dd></div><div><dt>노드 ID</dt><dd class="node-id">{host?.nodeId || '등록 후 표시돼요'}</dd></div></dl>
        <p class="network-note">로컬 IP는 현재 네트워크 안에서 사용하는 주소이며 공인 IP와 다를 수 있어요.</p>
      </article>
      {#if error}<p class="feedback error" role="alert">{error}</p>{:else if notice}<p class="feedback" role="status">{notice}</p>{/if}
    </div>
    <aside class="host-summary"><div class="art"><img src={nodeArt} alt="MarioNet Host"/></div><h2>어디서든 접속하세요</h2><p>설정을 마치고<br/>어디서든 제어하세요</p><div class="signed-account"><span>로그인 계정</span><strong>{user.email}</strong></div><button class="logout" disabled={busy} onclick={signout}>로그아웃</button><small>로그아웃하거나 앱을 종료하면<br/>호스트 연결도 종료돼요.</small></aside>
  </div>
</section>

<style>
  .host-home{min-height:100svh;padding:86px 6% 40px;background:#171727}.heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:34px}.heading h1{font-size:26px;letter-spacing:-1px;margin:0 0 12px}.heading p:not(.eyebrow){font-size:13px;color:#9297b3;margin:0}.status{display:flex;align-items:center;gap:9px;border:1px solid #ffffff12;background:#22243a;padding:11px 16px;border-radius:24px;font-size:12px;white-space:nowrap;color:#aeb4cd}.status i{width:7px;height:7px;border-radius:50%;background:#82869e}.status.online{color:#a5dfb6}.online i{background:#8fce9e;box-shadow:0 0 0 4px #8fce9e12}.host-grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:24px;max-width:1300px;margin:auto}.settings{display:flex;flex-direction:column;gap:20px}article{background:#212238;border:1px solid #ffffff08;border-radius:20px;padding:28px}.section-heading{display:flex;gap:14px;align-items:center}.number{font-size:11px;color:#86aaff;background:#3067ee18;width:36px;height:36px;display:grid;place-items:center;border-radius:12px}h2{font-size:16px;margin:0 0 7px}.section-heading p{margin:0;color:#9298b5;font-size:12px}form{margin:26px 0}.name-row{display:flex;gap:12px}.name-row input{border-radius:12px;background:#191a2b}.primary{padding:0 24px;min-height:46px;border:0;border-radius:12px;background:#2864ef;color:white;font-size:13px;white-space:nowrap}.primary:hover:not(:disabled){background:#4079fc}.primary:disabled{opacity:.4}.permission,.resolution{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-top:22px;border-top:1px solid #ffffff0b}h3{font-size:14px;margin:0 0 8px}.permission p,.resolution p{font-size:12px;line-height:1.7;color:#949ab5;margin:0}.switch{width:50px;height:28px;border:0;border-radius:20px;padding:4px;background:#474b64;flex-shrink:0;transition:background .2s}.switch span{display:block;width:20px;height:20px;background:#d4d6e0;border-radius:50%;transition:transform .2s}.switch.enabled{background:#81b987}.switch.enabled span{transform:translateX(22px);background:#c5ffd0}.switch:disabled{opacity:.4}.resolution select{min-width:150px;height:38px;padding:0 10px;border:1px solid #ffffff16;border-radius:9px;background:#191a2b;color:#dce5fa;font-size:12px}.resolution select:disabled{opacity:.45}.resolution-detail{font-size:11px;color:#7f89a5;line-height:1.7;margin:11px 0 0}.development{font-size:11px;color:#9da6c2;line-height:1.9;margin:22px 0 0;background:#191b2d;padding:13px 16px;border-radius:10px}.register{margin-bottom:24px}.register p{font-size:12px;line-height:1.8;color:#afb6cf}dl{margin:25px 0 0}dl>div{display:flex;gap:20px;justify-content:space-between;margin:16px 0;font-size:12px}dt{color:#929ab8;white-space:nowrap}dd{margin:0;text-align:right;overflow-wrap:anywhere;color:#d7dbee}.node-id{font-family:monospace;font-size:11px}.network-note{font-size:11px;color:#787f9d;line-height:1.6;margin:20px 0 0}.host-summary{background:#24263d;border:1px solid #ffffff08;border-radius:20px;text-align:center;overflow:hidden;padding:0 26px 26px;display:flex;flex-direction:column;align-items:center}.art{height:225px;margin-top:-12px;margin-bottom:28px}.art img{height:100%;width:auto}.host-summary h2{font-size:18px}.host-summary>p{font-size:12px;line-height:1.9;color:#929ab5;margin:6px 0 30px}.signed-account{margin-top:auto;padding:22px 0 18px;border-top:1px solid #ffffff0d;width:100%}.signed-account span{display:block;font-size:10px;color:#8d95b1;margin-bottom:9px}.signed-account strong{font-size:12px;font-weight:500;overflow-wrap:anywhere}.logout{width:100%;height:40px;border:1px solid #ffffff15;background:transparent;color:#b7bfd7;border-radius:10px;font-size:12px}.logout:hover{background:#ffffff08}small{font-size:10px;line-height:1.8;color:#79819e;margin-top:16px}.feedback{font-size:12px;color:#a9d8b8;padding:0 8px;margin:0}.feedback.error{color:#ffa3af}@media(max-width:1100px){.host-home{padding-left:4%;padding-right:4%}.host-grid{grid-template-columns:minmax(0,1fr) 240px;gap:18px}article{padding:23px}.heading h1{font-size:23px}}@media(prefers-reduced-motion:reduce){.switch,.switch span{transition:none}}
</style>

