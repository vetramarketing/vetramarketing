'use strict';

(() => {
  const copy = {
    th: {
      heading: 'ปลดล็อกพื้นที่ทำงาน',
      pin: 'รหัส PIN 8 หลัก',
      submit: 'ปลดล็อก',
      busy: 'กำลังปลดล็อก…',
      languages: 'ภาษา',
      format: 'กรุณากรอกรหัส PIN เป็นตัวเลข 8 หลัก',
      invalid: 'ปลดล็อกไม่สำเร็จ กรุณาตรวจสอบรหัส PIN แล้วลองอีกครั้ง',
      limited: 'กรุณารอสักครู่แล้วลองปลดล็อกอีกครั้ง',
      unavailable: 'ยังไม่สามารถปลดล็อกพื้นที่ทำงานได้ กรุณาลองอีกครั้งภายหลัง',
    },
    en: {
      heading: 'Unlock your workspace',
      pin: '8-digit PIN',
      submit: 'Unlock',
      busy: 'Unlocking…',
      languages: 'Language',
      format: 'Enter an 8-digit PIN.',
      invalid: 'The workspace could not be unlocked. Check your PIN and try again.',
      limited: 'Please wait before trying again.',
      unavailable: 'Workspace access is temporarily unavailable. Please try again later.',
    },
  };
  const form = document.getElementById('unlock-form');
  const pin = document.getElementById('pin');
  const submit = document.getElementById('submit');
  const status = document.getElementById('access-status');
  const languages = document.getElementById('languages');
  const buttons = languages.querySelectorAll('button');
  const query = new URLSearchParams(location.search);
  const error = query.get('error');
  let message = ['invalid', 'limited', 'unavailable'].includes(error) ? error : '';
  let locale = 'th';
  try {
    if (localStorage.getItem('vetra-marketing.locale') === 'en') locale = 'en';
  } catch {
    // The form also works when the browser disallows persistent storage.
  }

  function render() {
    const text = copy[locale];
    document.documentElement.lang = locale;
    document.title = text.heading + ' | VETRA Marketing';
    document.getElementById('heading').textContent = text.heading;
    document.getElementById('pin-label').textContent = text.pin;
    submit.textContent = submit.disabled ? text.busy : text.submit;
    status.textContent = message ? text[message] : '';
    if (message) pin.setAttribute('aria-describedby', 'access-status');
    else pin.removeAttribute('aria-describedby');
    if (message === 'invalid') pin.setAttribute('aria-invalid', 'true');
    else pin.removeAttribute('aria-invalid');
    if (pin.validity.customError) pin.setCustomValidity(text.format);
    languages.setAttribute('aria-label', text.languages);
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.locale === locale));
    }
  }
  for (const button of buttons) {
    button.addEventListener('click', () => {
      locale = button.dataset.locale;
      try {
        localStorage.setItem('vetra-marketing.locale', locale);
      } catch {
        // The chosen language still applies to the current page.
      }
      render();
    });
  }
  pin.addEventListener('invalid', () => pin.setCustomValidity(copy[locale].format));
  pin.addEventListener('input', () => {
    pin.setCustomValidity('');
    if (message === 'invalid') {
      message = '';
      render();
    }
  });
  form.addEventListener('submit', (event) => {
    if (submit.disabled) {
      event.preventDefault();
      return;
    }
    submit.disabled = true;
    submit.textContent = copy[locale].busy;
    form.setAttribute('aria-busy', 'true');
  });
  window.addEventListener('pagehide', () => {
    pin.value = '';
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    submit.disabled = false;
    form.removeAttribute('aria-busy');
    render();
  });
  render();
  languages.hidden = false;
})();
