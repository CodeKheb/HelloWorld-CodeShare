document.addEventListener('DOMContentLoaded', () => {
document.querySelectorAll('[data-route]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const route = e.currentTarget.getAttribute('data-route');
    window.location.href = `/${route}`;
  });
});
});
