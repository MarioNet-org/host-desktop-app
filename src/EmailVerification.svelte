<script lang="ts">
  let { user }: { user: User } = $props();
  let verified = $state(false);
  let busy = $state(false);
  let message = $state('');
  async function check(resend: boolean) {
    busy = true; message = '';
    try {
      const result = await window.marioNet!.verification(resend);
      if (result.ok) { verified = !!result.emailVerified; message = resend ? '인증 메일을 보냈어요. 받은편지함과 스팸함을 확인해주세요.' : verified ? '이메일 인증을 완료했어요.' : '아직 인증되지 않았어요. 메일의 인증 버튼을 먼저 눌러주세요.'; }
      else message = result.code === 'MAIL_UNAVAILABLE' ? '메일을 보내지 못했어요. 발송 설정 또는 Resend 테스트 수신 주소를 확인해주세요.' : result.code === 'RATE_LIMITED' ? '재발송 요청이 많아요. 잠시 후 다시 시도해주세요.' : '요청을 완료하지 못했어요. 네트워크 연결을 확인해주세요.';
    } catch { message = '요청을 완료하지 못했어요.'; }
    finally { busy = false; }
  }
</script>
{#if !user.emailVerified && !verified}
  <div class="verification-panel">
    <strong>이메일 인증이 필요해요</strong><p>{user.email}의 인증 메일을 확인해주세요. 인증 후 PC를 등록할 수 있어요.</p>
    <div><button disabled={busy} onclick={() => check(true)}>인증 메일 재발송</button><button disabled={busy} onclick={() => check(false)}>인증 상태 확인</button></div>
    {#if message}<p role="status">{message}</p>{/if}
  </div>
{:else if message}<p class="verified" role="status">{message}</p>{/if}
<style>
 .verification-panel{flex:none;padding:16px 18px;border:1px solid #6482c440;border-radius:12px;background:#242c45;margin-bottom:18px;color:#dfe8ff}.verification-panel strong{font-size:13px}.verification-panel p{font-size:12px;line-height:1.7;overflow-wrap:anywhere;margin:8px 0;color:#b9c5df}.verification-panel div{display:flex;gap:10px;flex-wrap:wrap}.verification-panel button{background:#33456b;color:#e1eaff;border:0;border-radius:8px;padding:9px 12px;font-size:12px}.verification-panel button:disabled{opacity:.5}.verified{color:#a8dbb5;font-size:12px}
</style>
