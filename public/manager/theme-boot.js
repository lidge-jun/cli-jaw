(function () {
  try {
    var saved = localStorage.getItem('jaw.uiTheme');
    if (saved !== 'dark' && saved !== 'light' && saved !== 'auto') saved = 'auto';
    document.documentElement.setAttribute('data-theme', saved);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'auto');
  }
})();
