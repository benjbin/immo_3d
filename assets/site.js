// Neokrome .tech — comportements communs : menu mobile, en-tête, apparitions, film, démo, formulaire
(() => {
  document.documentElement.classList.add('js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // menu mobile
  const burger = $('.burger'), nav = $('#nav');
  if (burger && nav) {
    const fermer = (focus) => { nav.classList.remove('ouvert'); burger.setAttribute('aria-expanded', 'false'); if (focus) burger.focus(); };
    burger.addEventListener('click', () => {
      const ouvert = nav.classList.toggle('ouvert');
      burger.setAttribute('aria-expanded', String(ouvert));
      if (ouvert) nav.querySelector('a')?.focus();
    });
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) fermer(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('ouvert')) fermer(true); });
    matchMedia('(min-width: 961px)').addEventListener('change', (e) => { if (e.matches) fermer(false); });
  }

  // ombre de l'en-tête au défilement
  const entete = $('.entete');
  const surDefile = () => entete && entete.classList.toggle('defile', scrollY > 8);
  addEventListener('scroll', surDefile, { passive: true }); surDefile();

  // apparitions en cascade
  $$('.apparait').forEach((el) => {
    const freres = [...el.parentElement.children].filter((c) => c.classList.contains('apparait'));
    el.style.setProperty('--i', Math.min(freres.indexOf(el), 6));
  });
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('vu'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('.apparait').forEach((el) => io.observe(el));
  // le haut de page ne doit jamais attendre l'observateur (onglet en arrière-plan, navigateur lent…)
  $$('.hero .apparait').forEach((el) => requestAnimationFrame(() => el.classList.add('vu')));
  setTimeout(() => $$('.apparait').forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('vu'); }), 1200);

  // film : lecture muette en boucle quand il est visible, bouton pause accessible
  const film = $('video[data-film]'), btnFilm = $('.pause-film');
  if (film) {
    if (reduit) { film.removeAttribute('autoplay'); film.pause(); }
    const majBouton = () => { if (btnFilm) { const lecture = !film.paused; btnFilm.textContent = lecture ? 'Mettre le film en pause' : 'Lire le film'; btnFilm.setAttribute('aria-pressed', String(!lecture)); } };
    new IntersectionObserver((es) => es.forEach((e) => {
      if (reduit || film.dataset.manuel) return;
      if (e.isIntersecting) film.play().catch(() => {}); else film.pause();
    }), { threshold: 0.35 }).observe(film);
    film.addEventListener('play', majBouton); film.addEventListener('pause', majBouton);
    btnFilm?.addEventListener('click', () => { film.dataset.manuel = '1'; film.paused ? film.play().catch(() => {}) : film.pause(); });
    majBouton();
  }

  // démo : la maquette 3D ne se charge qu'à la demande (elle est lourde)
  $$('[data-lancer-demo]').forEach((btn) => btn.addEventListener('click', () => {
    const cadre = btn.closest('.cadre-demo'), voile = btn.closest('.lancer');
    const f = document.createElement('iframe');
    f.src = cadre.dataset.src; f.title = 'Maquette 3D interactive de la résidence Canopée';
    f.allow = 'fullscreen'; f.setAttribute('allowfullscreen', '');
    cadre.appendChild(f); voile.hidden = true; f.focus();
  }));

  // formulaire de contact : validation, puis ouverture de la messagerie (pas de serveur)
  const form = $('#form-contact');
  if (form) {
    const msg = $('.message-envoi', form);
    const erreur = (champ, texte) => {
      const p = document.getElementById(champ.getAttribute('aria-describedby'));
      champ.setAttribute('aria-invalid', texte ? 'true' : 'false');
      if (p) { p.textContent = texte || ''; p.hidden = !texte; }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nom = form.nom.value.trim(), mail = form.email.value.trim();
      const okMail = /^\S+@\S+\.\S+$/.test(mail);
      erreur(form.nom, nom ? '' : 'Indiquez votre nom.');
      erreur(form.email, okMail ? '' : 'Saisissez une adresse e-mail valide, par exemple nom@promoteur.fr.');
      if (!nom || !okMail) { (!nom ? form.nom : form.email).focus(); return; }
      const corps = [`Nom : ${nom}`, `Société : ${form.societe.value.trim()}`, `E-mail : ${mail}`, `Téléphone : ${form.tel.value.trim()}`, `Besoin : ${form.besoin.value}`, '', form.message.value.trim()].join('\n');
      const dest = form.dataset.destinataire;
      location.href = `mailto:${dest}?subject=${encodeURIComponent('Demande de démo Neokrome — ' + (form.societe.value.trim() || nom))}&body=${encodeURIComponent(corps)}`;
      msg.textContent = `Merci ${nom}. Votre messagerie s'ouvre avec la demande pré-remplie : il ne reste qu'à l'envoyer.`;
      msg.hidden = false;
    });
  }
})();
