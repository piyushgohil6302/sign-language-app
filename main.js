/* ═══════════════════════════════════════════════════════════════
   SignLive AI — Home Page Interactions
   Handles: loading, navbar, scroll animations, mobile menu
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // ─── Loading Overlay ───
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        loadingOverlay.classList.add('hidden');
      }, 600);
    });
    // Fallback: hide after 3s regardless
    setTimeout(() => {
      loadingOverlay.classList.add('hidden');
    }, 3000);
  }

  // ─── Navbar Scroll Effect ───
  const navbar = document.getElementById('navbar');
  if (navbar && !navbar.classList.contains('scrolled')) {
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
      const currentScroll = window.pageYOffset;
      if (currentScroll > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
      lastScroll = currentScroll;
    }, { passive: true });
  }

  // ─── Mobile Hamburger Menu ───
  const hamburger = document.getElementById('navHamburger');
  const navLinks = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('open');
    });

    // Close menu when clicking a link
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinks.classList.remove('open');
      });
    });

    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
        hamburger.classList.remove('active');
        navLinks.classList.remove('open');
      }
    });
  }

  // ─── Scroll Fade-in Animations ───
  const fadeElements = document.querySelectorAll('.fade-in-section');
  if (fadeElements.length > 0) {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const fadeObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          fadeObserver.unobserve(entry.target);
        }
      });
    }, observerOptions);

    fadeElements.forEach(el => fadeObserver.observe(el));
  }

  // ─── Smooth Scroll for Anchor Links ───
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        const offset = 80; // navbar height
        const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // ─── Parallax Effect on Hero ───
  const hero = document.querySelector('.hero-visual');
  if (hero) {
    window.addEventListener('scroll', () => {
      const scrolled = window.pageYOffset;
      const rate = scrolled * 0.15;
      hero.style.transform = `translateY(${rate}px)`;
    }, { passive: true });
  }

  // ─── Typing Effect on Translation Bubbles ───
  const bubbles = document.querySelectorAll('.translation-bubble');
  if (bubbles.length > 0) {
    const texts = ['✋ → "Hello"', '🤟 → "I Love You"', '✌️ → "Peace"'];
    let currentBubble = 0;

    setInterval(() => {
      bubbles.forEach((b, i) => {
        b.style.opacity = '0.3';
        b.style.transform = 'scale(0.95)';
        b.style.transition = 'all 0.3s ease';
      });

      bubbles[currentBubble].style.opacity = '1';
      bubbles[currentBubble].style.transform = 'scale(1.05)';
      bubbles[currentBubble].style.boxShadow = '0 0 20px rgba(0, 212, 255, 0.3)';

      setTimeout(() => {
        bubbles[currentBubble].style.transform = 'scale(1)';
        bubbles[currentBubble].style.boxShadow = 'none';
      }, 1500);

      currentBubble = (currentBubble + 1) % bubbles.length;
    }, 2500);
  }

  // ─── Counter Animation for Stats ───
  const statValues = document.querySelectorAll('.stat-value');
  if (statValues.length > 0) {
    const animateCounter = (el) => {
      const text = el.textContent;
      const match = text.match(/^(\d+)/);
      if (!match) return;

      const target = parseInt(match[1]);
      const suffix = text.replace(match[1], '');
      const duration = 2000;
      const start = performance.now();

      const update = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out
        const current = Math.round(target * eased);
        el.textContent = current + suffix;

        if (progress < 1) {
          requestAnimationFrame(update);
        }
      };

      requestAnimationFrame(update);
    };

    const statsObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const values = entry.target.querySelectorAll('.stat-value');
          values.forEach(v => animateCounter(v));
          statsObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });

    const statsBar = document.querySelector('.stats-bar');
    if (statsBar) statsObserver.observe(statsBar);
  }
});
