(() => {
  let invitation = new URLSearchParams(location.hash.slice(1)).get('activate');
  history.replaceState(null, '', location.pathname);
  const frame = document.getElementById('catalog');
  window.addEventListener('message', e => {
    if (e.source !== frame.contentWindow || e.origin !== 'https://catalog-formula.91.222.238.9.nip.io' || e.data?.type !== 'catalog-ready') return;
    if (invitation) {frame.contentWindow.postMessage({type:'catalog-activate',invitation}, e.origin);invitation = '';}
  });
  // Register the activation handshake before the remote frame can signal ready.
  frame.src = 'https://catalog-formula.91.222.238.9.nip.io/access/';
})();
