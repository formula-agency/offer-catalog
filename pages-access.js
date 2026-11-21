(() => {
  let invitation = new URLSearchParams(location.hash.slice(1)).get('activate');
  history.replaceState(null, '', location.pathname);
  const frame = document.getElementById('catalog');
  const STORAGE_KEY = 'formula-catalog-session-v1', IDLE_MS = 30 * 60 * 1000;
  function savedSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      if (session && /^[A-Za-z0-9_-]{30,100}$/.test(session.token || '') && Number.isFinite(session.lastActivity)
        && session.lastActivity <= Date.now() + 60000 && Date.now() - session.lastActivity < IDLE_MS) return session;
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
    return null;
  }
  window.addEventListener('message', e => {
    if (e.source !== frame.contentWindow || e.origin !== 'https://catalog-formula.91.222.238.9.nip.io') return;
    if (e.data?.type === 'catalog-session') {
      try {
        const session = e.data.session;
        if (session && /^[A-Za-z0-9_-]{30,100}$/.test(session.token || '') && Number.isFinite(session.lastActivity)) {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify({token:session.token,lastActivity:session.lastActivity}));
        } else sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
    if (e.data?.type !== 'catalog-ready') return;
    if (invitation) {frame.contentWindow.postMessage({type:'catalog-activate',invitation}, e.origin);invitation = '';}
    else frame.contentWindow.postMessage({type:'catalog-restore',session:savedSession()}, e.origin);
  });
  // Register the activation handshake before the remote frame can signal ready.
  frame.src = 'https://catalog-formula.91.222.238.9.nip.io/access/';
})();
