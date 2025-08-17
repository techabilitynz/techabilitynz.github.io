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

/* Tech Ability, lightweight UX effects
   Motion is subtle, accessible, keyboard friendly, and keeps icon colors unchanged. */

(function(){
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 1) Reveal on scroll */
  const toReveal = document.querySelectorAll('.reveal, .card-service, .card-hyper, .speedtest-frame, .hero-box img');
  if (!prefersReduced && 'IntersectionObserver' in window){
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting){
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    toReveal.forEach(el => io.observe(el));
  } else {
    toReveal.forEach(el => el.classList.add('is-visible'));
  }

  /* 2) Gentle 3D tilt for cards on mouse move, no color changes */
  if (!prefersReduced){
    const tiltables = document.querySelectorAll('.card-service, .card-hyper');
    const strength = 6; // degrees, keep it subtle

    tiltables.forEach(card => {
      let raf = null;

      function onMove(e){
        const r = card.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const rx = ((y - r.height / 2) / r.height) * -strength;
        const ry = ((x - r.width / 2) / r.width) * strength;

        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          card.style.setProperty('--tiltX', rx.toFixed(2) + 'deg');
          card.style.setProperty('--tiltY', ry.toFixed(2) + 'deg');
          // for hyper cards, paint a soft radial glow under pointer
          card.style.setProperty('--mx', (x / r.width) * 100 + '%');
          card.style.setProperty('--my', (y / r.height) * 100 + '%');
        });
      }

      function onLeave(){
        if (raf) cancelAnimationFrame(raf);
        card.style.setProperty('--tiltX', '0deg');
        card.style.setProperty('--tiltY', '0deg');
      }

      card.addEventListener('mousemove', onMove, { passive: true });
      card.addEventListener('mouseleave', onLeave);
    });
  }

  /* 3) Keyboard focus hint on cards, adds a tiny lift when tabbing */
  const focusables = document.querySelectorAll('.card-service a, .card-hyper a, .card-service button, .card-hyper button');
  focusables.forEach(el => {
    el.addEventListener('focus', () => {
      const card = el.closest('.card-service, .card-hyper');
      if (card && !prefersReduced){
        card.style.transform = 'translateY(-6px) rotateX(var(--tiltX, 0deg)) rotateY(var(--tiltY, 0deg))';
      }
    });
    el.addEventListener('blur', () => {
      const card = el.closest('.card-service, .card-hyper');
      if (card){
        card.style.transform = '';
      }
    });
  });

  /* 4) Progressive enhancement for the OST iframe
        If a content blocker prevents it from loading, show a quick link. */
  const ostFrame = document.querySelector('.speedtest-frame iframe');
  if (ostFrame){
    let fallbackTimer = setTimeout(() => {
      // Create a gentle inline fallback link below the widget
      const credit = document.querySelector('.speedtest-credit');
      if (credit){
        const p = document.createElement('p');
        p.className = 'small mt-2';
        p.innerHTML = 'If the test does not appear, <a href="https://openspeedtest.com/speedtest" target="_blank" rel="noopener">open it in a new tab</a>.';
        credit.parentNode.insertBefore(p, credit.nextSibling);
      }
    }, 4000);

    ostFrame.addEventListener('load', () => clearTimeout(fallbackTimer));
  }
})();
