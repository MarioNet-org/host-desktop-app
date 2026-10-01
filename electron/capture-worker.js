(() => {
  const sessions = new Map();
  const profiles = {
    standard: { width: 1920, height: 1080, frameRate: 30, maxBitrate: 14_000_000 },
    saver: { width: 1280, height: 720, frameRate: 24, maxBitrate: 4_000_000 },
    low: { width: 854, height: 480, frameRate: 20, maxBitrate: 1_200_000 },
    original: { frameRate: 30, maxBitrate: 16_000_000 },
  };
  const sourceConstraints = sourceId => ({ mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: 30 } });
  const send = (connectionId, kind, payload) => window.marioNetCapture.signal({ connectionId, kind, payload });
  const stop = id => {
    const session = sessions.get(id); if (!session) return;
    session.peer.close(); session.stopRender?.(); session.outputStream?.getTracks().forEach(track => track.stop()); session.sourceStream.getTracks().forEach(track => track.stop()); sessions.delete(id);
  };
  const cropStream = async (sourceStream, resolution) => {
    const profile = profiles[resolution] ?? profiles.standard;
    if (resolution === 'original') return { outputStream: sourceStream, stopRender: null, profile };
    const video = document.createElement('video'); video.muted = true; video.srcObject = sourceStream; await video.play();
    const sourceWidth = video.videoWidth; const sourceHeight = video.videoHeight;
    const sourceRatio = sourceWidth / sourceHeight;
    // Avoid a second encode and resize when the captured display is already
    // the requested 16:9 size. This keeps UI text sharper on 1080p screens.
    if (Math.abs(sourceRatio - (16 / 9)) < 0.005 && sourceWidth <= profile.width && sourceHeight <= profile.height) {
      video.srcObject = null;
      return { outputStream: sourceStream, stopRender: null, profile };
    }
    const { width, height } = profile;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    let frame;
    const render = () => {
      const currentWidth = video.videoWidth || width; const currentHeight = video.videoHeight || height;
      const scale = Math.min(width / currentWidth, height / currentHeight);
      const drawWidth = Math.round(currentWidth * scale); const drawHeight = Math.round(currentHeight * scale);
      const drawX = Math.round((width - drawWidth) / 2); const drawY = Math.round((height - drawHeight) / 2);
      context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
      context.drawImage(video, 0, 0, currentWidth, currentHeight, drawX, drawY, drawWidth, drawHeight); frame = requestAnimationFrame(render);
    };
    render(); return { outputStream: canvas.captureStream(profile.frameRate), stopRender: () => { cancelAnimationFrame(frame); video.srcObject = null; }, profile };
  };
  const start = async ({ connection, sourceId, resolution = 'standard' }) => {
    if (!connection?.id || !sourceId || sessions.has(connection.id)) return;
    try {
      console.info('Capture worker starting', connection.id);
      const sourceStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: sourceConstraints(sourceId) });
      console.info('Capture worker stream ready', connection.id);
      sourceStream.getVideoTracks()[0].contentHint = 'detail';
      const { outputStream, stopRender, profile } = await cropStream(sourceStream, resolution);
      outputStream.getVideoTracks()[0].contentHint = 'detail';
      const peer = new RTCPeerConnection();
      const session = { peer, sourceStream, outputStream, stopRender, pendingIce: [] }; sessions.set(connection.id, session);
      const configureSender = async sender => {
        const parameters = sender.getParameters();
        parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
        parameters.encodings[0].maxBitrate = profile.maxBitrate;
        parameters.encodings[0].maxFramerate = profile.frameRate;
        parameters.degradationPreference = 'maintain-resolution';
        await sender.setParameters(parameters);
      };
      const sender = peer.addTrack(outputStream.getVideoTracks()[0], outputStream);
      try { await configureSender(sender); console.info('Capture worker encoding configured', connection.id, `${profile.maxBitrate / 1_000_000} Mbps`); }
      catch (error) { console.warn('Capture worker could not apply encoding limits', connection.id, error); }
      sourceStream.getVideoTracks().forEach(track => { track.onended = () => stop(connection.id); });
      peer.onicecandidate = event => { if (event.candidate) send(connection.id, 'ice', event.candidate.toJSON()); };
      peer.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) stop(connection.id); };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      try { await configureSender(sender); } catch (error) { console.warn('Capture worker could not retain encoding limits', connection.id, error); }
      console.info('Capture worker sending offer', connection.id); send(connection.id, 'offer', offer);
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
