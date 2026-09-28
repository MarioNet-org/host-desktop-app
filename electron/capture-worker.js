(() => {
  const sessions = new Map();
  const sourceConstraints = sourceId => ({ mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: 20, maxWidth: 1920, maxHeight: 1080 } });
  const send = (connectionId, kind, payload) => window.marioNetCapture.signal({ connectionId, kind, payload });
  const stop = id => {
    const session = sessions.get(id); if (!session) return;
    session.peer.close(); session.stream.getTracks().forEach(track => track.stop()); sessions.delete(id);
  };
  const start = async ({ connection, sourceId }) => {
    if (!connection?.id || !sourceId || sessions.has(connection.id)) return;
    try {
      console.info('Capture worker starting', connection.id);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: sourceConstraints(sourceId) });
      console.info('Capture worker stream ready', connection.id);
      const peer = new RTCPeerConnection();
      const session = { peer, stream, pendingIce: [] }; sessions.set(connection.id, session);
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      stream.getVideoTracks().forEach(track => { track.onended = () => stop(connection.id); });
      peer.onicecandidate = event => { if (event.candidate) send(connection.id, 'ice', event.candidate.toJSON()); };
      peer.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) stop(connection.id); };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer); console.info('Capture worker sending offer', connection.id); send(connection.id, 'offer', offer);
    } catch (error) { console.error('Capture worker failed', connection?.id, error); stop(connection?.id); }
  };
  window.marioNetCapture.onStart(start);
  window.marioNetCapture.onStop(stop);
  window.marioNetCapture.onSignal(async signal => {
    const session = sessions.get(signal?.connectionId); if (!session) return;
    try {
      if (signal.kind === 'answer') { await session.peer.setRemoteDescription(signal.payload); for (const candidate of session.pendingIce) await session.peer.addIceCandidate(candidate); session.pendingIce = []; }
      else if (signal.kind === 'ice') { if (!session.peer.remoteDescription) session.pendingIce.push(signal.payload); else await session.peer.addIceCandidate(signal.payload); }
    } catch (error) { console.error('Capture worker signaling failed', signal?.connectionId, error); stop(signal?.connectionId); }
  });
  window.marioNetCapture.ready();
})();
