(function () {
  const btn = document.getElementById('back-to-top');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function toggleBtn() {
    const s = document.documentElement.scrollTop || document.body.scrollTop;
    btn.style.display = s > 100 ? 'inline-flex' : 'none';
  }

  btn.addEventListener('click', function () {
    if (prefersReduced) {
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  window.addEventListener('scroll', toggleBtn, { passive: true });
  toggleBtn();
})();
