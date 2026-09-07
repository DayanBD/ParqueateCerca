// Marca Inicio por defecto al cargar la página
document.addEventListener('DOMContentLoaded', function () {
    const links = document.querySelectorAll('.navbar-nav .nav-link');

    // Marca el link según la página actual
    const currentPage = window.location.pathname;

    if (currentPage === '/' || currentPage.includes('index.html')) {
        const inicioLink = document.querySelector('.nav-link[href="#inicio"]');
        if (inicioLink) inicioLink.classList.add('active');
    }

    // Cambia el active al hacer scroll
    window.addEventListener('scroll', function () {
        const sections = document.querySelectorAll('section[id], footer[id]');
        let current = '';

        sections.forEach(section => {
            if (window.scrollY >= section.offsetTop - 100) {
                current = section.getAttribute('id');
            }
        });

        links.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    });
});