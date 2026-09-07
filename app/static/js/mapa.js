/**
 * mapa.js — Módulo del mapa interactivo — Parquéate Cerca
 * Responsabilidades:
 *   - Toggle del sidebar y logout (patrón compartido con vehiculos.js)
 *   - Carga del avatar en sidebar desde la API de perfil
 *   - Inicialización del mapa Leaflet con tiles Carto Dark Matter
 *   - Geolocalización del usuario con manejo de errores (RF_16, RF_17)
 *   - Carga de marcadores de parqueaderos desde la API (RF_18)
 *   - Población y visibilidad de la card de preview al hacer clic
 *   - Botón flotante para recentrar el mapa en la última ubicación conocida
 *   - Buscador de parqueaderos por nombre, con salto directo al marcador
 */

// id del parqueadero del usuario, si ya tiene uno registrado (null si no).
// Controla el ícono y el destino del botón "Registrar mi parqueadero".
let _idParqueaderoDelUsuario = null;

// Instancia del mapa Leaflet, accesible desde cualquier función del archivo.
let _mapaInstancia = null;

// Última coordenada conocida del usuario, para recentrar sin tener
// que volver a pedir permiso de geolocalización cada vez.
let _ultimaUbicacion = null;

// Lista completa de parqueaderos cargados desde la API, en memoria
// para que el buscador filtre sin volver a golpear el backend.
let _parqueaderosCache = [];

// Mapa de id_parqueadero → marcador Leaflet, para poder centrar y
// abrir la preview de un resultado de búsqueda sin recorrer la lista.
let _marcadoresPorId = {};

// Control de ruteo activo de Leaflet Routing Machine (solo una ruta a la vez)
let _rutaActiva = null;

// Parqueadero actualmente mostrado en la card de preview, para que
// el botón "Cómo llegar" sepa hacia dónde trazar la ruta
let _parqueaderoEnPreview = null;

document.addEventListener('DOMContentLoaded', function () {

    // ── Botón Registrar Parqueadero / ir al panel de administrador ──────────
    const btnRegistrarParqueadero = document.getElementById('btnRegistrarParqueadero');
    if (btnRegistrarParqueadero) {
        btnRegistrarParqueadero.addEventListener('click', async function (e) {
            e.preventDefault();

            if (!_idParqueaderoDelUsuario) {
                window.location.href = '/conductor/parqueadero/registrar';
                return;
            }

            // El conductor ya tiene un parqueadero: antes de ir al panel de
            // administrador hay que cambiar el perfil activo a Administrador,
            // porque /administrador/movimientos está protegida por
            // rol_administrador_requerido y exige ese perfil en sesión.
            try {
                const res = await fetch('/api/usuario/cambiar-perfil', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ perfil: 2 })
                });

                if (!res.ok) return;

                window.location.href = '/administrador/movimientos';

            } catch (_) { }
        });
    }

    // ── Toggle del sidebar ───────────────────────────────────────────────────
    const btnToggle = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');

    if (btnToggle && sidebar) {
        btnToggle.addEventListener('click', function () {
            sidebar.classList.toggle('expanded');
            if (mainContent) mainContent.classList.toggle('expanded');
        });
    }

    // ── Botón Cerrar Preview ─────────────────────────────────────────────────
    const btnCerrarPreview = document.getElementById('btnCerrarPreview');
    if (btnCerrarPreview) {
        btnCerrarPreview.addEventListener('click', ocultarPreview);
    }

    // ── Botón Reintentar geolocalización (RF_17) ─────────────────────────────
    const btnReintentar = document.getElementById('btnReintentar');
    if (btnReintentar) {
        btnReintentar.addEventListener('click', function () {
            ocultarAlertaUbicacion();
            solicitarUbicacion();
        });
    }

    // ── Botón centrar en mi ubicación ────────────────────────────────────────
    const btnCentrarUbicacion = document.getElementById('btnCentrarUbicacion');
    if (btnCentrarUbicacion) {
        btnCentrarUbicacion.addEventListener('click', centrarEnMiUbicacion);
    }

    // ── Botón Cómo llegar ────────────────────────────────────────────────────
    const btnComoLlegar = document.getElementById('btnComoLlegar');
    if (btnComoLlegar) {
        btnComoLlegar.addEventListener('click', function (e) {
            e.preventDefault();
            if (_parqueaderoEnPreview) trazarRuta(_parqueaderoEnPreview);
        });
    }

    // ── Botón Quitar ruta ────────────────────────────────────────────────────
    const btnQuitarRuta = document.getElementById('btnQuitarRuta');
    if (btnQuitarRuta) {
        btnQuitarRuta.addEventListener('click', quitarRuta);
    }

    // ── Buscador de parqueaderos ──────────────────────────────────────────────
    const inputBuscar = document.getElementById('inputBuscarParqueadero');
    const btnLimpiarBusqueda = document.getElementById('btnLimpiarBusqueda');

    if (inputBuscar) {
        inputBuscar.addEventListener('input', function () {
            filtrarBusqueda(inputBuscar.value.trim());
        });

        // Al enfocar de nuevo con texto ya escrito, vuelve a mostrar
        // los resultados en vez de dejar el dropdown cerrado
        inputBuscar.addEventListener('focus', function () {
            if (inputBuscar.value.trim()) filtrarBusqueda(inputBuscar.value.trim());
        });
    }

    if (btnLimpiarBusqueda) {
        btnLimpiarBusqueda.addEventListener('click', limpiarBusqueda);
    }

    // Cierra el dropdown de resultados al hacer clic fuera del buscador
    document.addEventListener('click', function (e) {
        const contenedor = document.querySelector('.buscador-mapa');
        if (contenedor && !contenedor.contains(e.target)) {
            ocultarResultadosBusqueda();
        }
    });

    // ── Logout con SweetAlert2 ───────────────────────────────────────────────
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', function (e) {
            e.preventDefault();
            Swal.fire({
                title: '¿Cerrar sesión?',
                text: '¿Deseas cerrar tu sesión en Parquéate Cerca?',
                icon: 'question',
                iconColor: '#91f78e',
                background: '#001f2e',
                color: '#e0e0e0',
                showCancelButton: true,
                showCloseButton: true,
                confirmButtonText: 'Sí, cerrar sesión',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#ff5252',
                cancelButtonColor: '#91f78e',
                customClass: { closeButton: 'swal-close-custom' },
                didOpen: () => {
                    const popup = Swal.getPopup();
                    if (popup) {
                        popup.style.border = '2px solid #91f78e';
                        popup.style.borderRadius = '12px';
                    }
                    const confirmBtn = Swal.getConfirmButton();
                    const cancelBtn = Swal.getCancelButton();
                    if (confirmBtn) {
                        confirmBtn.style.borderRadius = '8px';
                        confirmBtn.style.fontSize = '1rem';
                    }
                    if (cancelBtn) {
                        cancelBtn.style.borderRadius = '8px';
                        cancelBtn.style.color = '#00101b';
                        cancelBtn.style.fontSize = '1rem';
                    }
                }
            }).then((result) => {
                if (result.isConfirmed) cerrarSesion();
            });
        });
    }

    // ── Inicialización ───────────────────────────────────────────────────────
    cargarAvatarSidebar();
    _mapaInstancia = inicializarMapa();
    solicitarUbicacion();
    cargarParqueaderos(_mapaInstancia);
});


// ── Inicializa el mapa Leaflet ────────────────────────────────────────────────

/**
 * Crea la instancia del mapa centrada en Valledupar con tiles Carto Dark Matter.
 * @returns {L.Map} Instancia del mapa
 */
function inicializarMapa() {
    const mapa = L.map('map', {
        center: [10.4631, -73.2532],
        zoom: 14,
        zoomControl: false
    });

    L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19 }
    ).addTo(mapa);

    // Control de zoom reposicionado abajo a la derecha
    L.control.zoom({ position: 'bottomright' }).addTo(mapa);

    return mapa;
}


// ── Geolocalización (RF_16, RF_17) ────────────────────────────────────────────

/**
 * Solicita la ubicación del navegador y centra el mapa en ella.
 * Muestra el punto azul si el permiso es concedido.
 * Muestra la alerta de RF_17 si el permiso es denegado o la posición
 * no está disponible.
 */
function solicitarUbicacion() {
    if (!navigator.geolocation) {
        mostrarAlertaUbicacion();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (posicion) {
            const lat = posicion.coords.latitude;
            const lng = posicion.coords.longitude;
            ubicarUsuario(lat, lng);
        },
        function (error) {
            // code 1: permiso denegado | code 2: posición no disponible
            if (error.code === 1 || error.code === 2) {
                mostrarAlertaUbicacion();
            }
            // code 3: timeout — se ignora silenciosamente
        },
        { timeout: 10000, maximumAge: 30000 }
    );
}

/**
 * Coloca el marcador del usuario en el mapa, centra la vista, y
 * guarda la coordenada en _ultimaUbicacion para que el botón de
 * recentrar pueda reutilizarla sin pedir permiso de nuevo.
 * @param {number} lat
 * @param {number} lng
 */
function ubicarUsuario(lat, lng) {
    _ultimaUbicacion = { lat, lng };

    const iconoPunto = L.divIcon({
        className: '',
        html: '<div class="user-location-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
    });

    L.marker([lat, lng], { icon: iconoPunto }).addTo(_mapaInstancia);
    _mapaInstancia.setView([lat, lng], 15);
}

/** Muestra la alerta de ubicación desactivada (RF_17). */
function mostrarAlertaUbicacion() {
    const alerta = document.getElementById('alertaUbicacion');
    if (alerta) alerta.classList.remove('d-none');
}

/** Oculta la alerta de ubicación. */
function ocultarAlertaUbicacion() {
    const alerta = document.getElementById('alertaUbicacion');
    if (alerta) alerta.classList.add('d-none');
}


// ── Botón: centrar en mi ubicación ─────────────────────────────────────────────

/**
 * Recentra el mapa en la última ubicación conocida del usuario. Si
 * todavía no se tiene ninguna, vuelve a solicitarla desde cero.
 */
function centrarEnMiUbicacion() {
    if (_ultimaUbicacion) {
        _mapaInstancia.setView([_ultimaUbicacion.lat, _ultimaUbicacion.lng], 15);
        return;
    }

    const btn = document.getElementById('btnCentrarUbicacion');
    if (btn) btn.classList.add('buscando');

    if (!navigator.geolocation) {
        mostrarAlertaUbicacion();
        if (btn) btn.classList.remove('buscando');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (posicion) {
            ubicarUsuario(posicion.coords.latitude, posicion.coords.longitude);
            if (btn) btn.classList.remove('buscando');
        },
        function (error) {
            if (error.code === 1 || error.code === 2) {
                mostrarAlertaUbicacion();
            }
            if (btn) btn.classList.remove('buscando');
        },
        { timeout: 10000, maximumAge: 30000 }
    );
}

// ── Trazado de ruta (Leaflet Routing Machine + OSRM demo) ────────────────────

/**
 * Traza la ruta desde la ubicación del usuario hasta el parqueadero
 * seleccionado. Si aún no se tiene la ubicación, la solicita primero.
 * @param {Object} destino - Parqueadero con latitud/longitud
 */
function trazarRuta(destino) {
    if (_ultimaUbicacion) {
        dibujarRuta(destino);
        return;
    }

    if (!navigator.geolocation) {
        mostrarAlertaUbicacion();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (posicion) {
            ubicarUsuario(posicion.coords.latitude, posicion.coords.longitude);
            dibujarRuta(destino);
        },
        function (error) {
            if (error.code === 1 || error.code === 2) mostrarAlertaUbicacion();
        },
        { timeout: 10000, maximumAge: 30000 }
    );
}

/**
 * Crea el control de ruteo sobre _mapaInstancia. Remueve cualquier ruta
 * previa para garantizar que solo exista una activa. Usa el servidor
 * demo público de OSRM (router.project-osrm.org): suficiente para el
 * alcance académico, pero no garantizado para producción real.
 * @param {Object} destino - Parqueadero con latitud/longitud
 */
function dibujarRuta(destino) {
    quitarRuta();

    _rutaActiva = L.Routing.control({
        waypoints: [
            L.latLng(_ultimaUbicacion.lat, _ultimaUbicacion.lng),
            L.latLng(destino.latitud, destino.longitud)
        ],
        position: 'bottomleft',
        collapsible: true,
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: true,
        show: true,
        language: 'es',
        units: 'metric',
        lineOptions: {
            styles: [{ color: '#91f78e', weight: 5, opacity: 0.85 }]
        },
        createMarker: function () { return null; }
    }).addTo(_mapaInstancia);

    _rutaActiva.on('routingerror', function () {
        Swal.fire({
            title: 'No se pudo calcular la ruta',
            text: 'El servicio de rutas no respondió. Intenta de nuevo en unos segundos.',
            icon: 'error',
            iconColor: '#ff5252',
            background: '#001f2e',
            color: '#e0e0e0',
            confirmButtonColor: '#91f78e'
        });
        quitarRuta();
    });

    document.getElementById('btnQuitarRuta')?.classList.remove('d-none');
}

/** Remueve la ruta activa del mapa, si existe. */
function quitarRuta() {
    if (_rutaActiva) {
        _mapaInstancia.removeControl(_rutaActiva);
        _rutaActiva = null;
    }
    document.getElementById('btnQuitarRuta')?.classList.add('d-none');
}


// ── Parqueaderos (RF_18) ──────────────────────────────────────────────────────

/**
 * Consulta GET /api/parqueaderos y agrega los marcadores al mapa.
 * Guarda la lista completa en _parqueaderosCache para el buscador.
 * Redirige al login si la sesión expiró (401).
 * @param {L.Map} mapa
 */
async function cargarParqueaderos(mapa) {
    try {
        const res = await fetch('/api/parqueaderos', { credentials: 'same-origin' });

        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }

        if (!res.ok) return;

        const parqueaderos = await res.json();
        _parqueaderosCache = parqueaderos;
        parqueaderos.forEach(p => agregarMarcador(mapa, p));

    } catch (_) { }
}

/**
 * Crea un DivIcon tipo pin circular y lo agrega al mapa. Guarda el
 * marcador en _marcadoresPorId para que el buscador pueda encontrarlo
 * directamente por id_parqueadero.
 * Los cupos disponibles se muestran al hacer clic, en la card de preview.
 * @param {L.Map} mapa
 * @param {Object} parqueadero - Objeto del parqueadero desde la API
 */
function agregarMarcador(mapa, parqueadero) {
    const lleno = parqueadero.cupos_disponibles === 0;
    const claseExtra = lleno ? ' lleno' : '';

    const icono = L.divIcon({
        className: '',
        html: `
            <div class="marcador-parqueadero${claseExtra}">
                <div class="marcador-burbuja">
                    <span class="material-symbols-outlined">local_parking</span>
                </div>
                <div class="marcador-pico"></div>
            </div>
        `,
        iconSize: [38, 44],
        iconAnchor: [19, 44]
    });

    const marcador = L.marker(
        [parqueadero.latitud, parqueadero.longitud],
        { icon: icono }
    ).addTo(mapa);

    marcador.on('click', function () {
        mostrarPreview(parqueadero);
    });

    _marcadoresPorId[parqueadero.id_parqueadero] = marcador;
}

// ── Card de preview ───────────────────────────────────────────────────────────

/**
 * Puebla la card con los datos del parqueadero y la hace visible.
 * @param {Object} parqueadero
 */
function mostrarPreview(parqueadero) {
    _parqueaderoEnPreview = parqueadero;
    const lleno = parqueadero.cupos_disponibles === 0;

    const elNombre = document.getElementById('previewNombre');
    const elCupos = document.getElementById('previewCupos');
    const elDistancia = document.getElementById('previewDistancia');
    const btnDetalles = document.getElementById('btnVerDetalles');
    const card = document.getElementById('parkingPreviewCard');

    if (elNombre) elNombre.textContent = parqueadero.nombre;
    if (elDistancia) elDistancia.textContent = parqueadero.direccion;

    if (elCupos) {
        elCupos.textContent = lleno
            ? 'Sin cupos disponibles'
            : `${parqueadero.cupos_disponibles} cupos disponibles`;
        elCupos.className = lleno ? 'lleno' : 'disponible';
    }

    if (btnDetalles) {
        btnDetalles.href = `/conductor/parqueadero/${parqueadero.id_parqueadero}`;
    }

    if (card) card.classList.remove('d-none');
}

/** Oculta la card de preview. */
function ocultarPreview() {
    const card = document.getElementById('parkingPreviewCard');
    if (card) card.classList.add('d-none');
}


// ── Buscador de parqueaderos ───────────────────────────────────────────────────

/**
 * Filtra _parqueaderosCache por nombre (sin distinguir mayúsculas) y
 * renderiza los resultados en el dropdown. Con el campo vacío, cierra
 * el dropdown sin mostrar nada.
 * @param {string} termino
 */
function filtrarBusqueda(termino) {
    const btnLimpiar = document.getElementById('btnLimpiarBusqueda');
    if (btnLimpiar) btnLimpiar.classList.toggle('d-none', !termino);

    if (!termino) {
        ocultarResultadosBusqueda();
        return;
    }

    const terminoLower = termino.toLowerCase();
    const resultados = _parqueaderosCache.filter(function (p) {
        return p.nombre.toLowerCase().includes(terminoLower);
    });

    renderizarResultadosBusqueda(resultados);
}

/**
 * Dibuja la lista de resultados en el dropdown, o un mensaje de
 * "sin resultados" si la lista está vacía.
 * @param {Array} resultados
 */
function renderizarResultadosBusqueda(resultados) {
    const contenedor = document.getElementById('resultadosBusqueda');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    if (resultados.length === 0) {
        contenedor.innerHTML = '<div class="buscador-sin-resultados">No se encontraron parqueaderos.</div>';
        contenedor.classList.remove('d-none');
        return;
    }

    resultados.forEach(function (p) {
        const item = document.createElement('div');
        item.className = 'resultado-item';
        item.innerHTML = `
            <span class="material-symbols-outlined">local_parking</span>
            <div class="resultado-item-texto">
                <div class="resultado-item-nombre">${p.nombre}</div>
                <div class="resultado-item-direccion">${p.direccion}</div>
            </div>
        `;
        item.addEventListener('click', function () {
            seleccionarParqueadero(p);
        });
        contenedor.appendChild(item);
    });

    contenedor.classList.remove('d-none');
}

/**
 * Centra el mapa en el parqueadero elegido, abre su card de preview,
 * y cierra el dropdown de resultados.
 * @param {Object} parqueadero
 */
function seleccionarParqueadero(parqueadero) {
    const input = document.getElementById('inputBuscarParqueadero');
    if (input) input.value = parqueadero.nombre;

    ocultarResultadosBusqueda();

    _mapaInstancia.setView([parqueadero.latitud, parqueadero.longitud], 17);

    const marcador = _marcadoresPorId[parqueadero.id_parqueadero];
    if (marcador) marcador.openPopup?.();

    mostrarPreview(parqueadero);
}

/** Limpia el campo de búsqueda y cierra el dropdown. */
function limpiarBusqueda() {
    const input = document.getElementById('inputBuscarParqueadero');
    if (input) input.value = '';
    document.getElementById('btnLimpiarBusqueda')?.classList.add('d-none');
    ocultarResultadosBusqueda();
}

/** Oculta el dropdown de resultados sin tocar el valor del input. */
function ocultarResultadosBusqueda() {
    const contenedor = document.getElementById('resultadosBusqueda');
    if (contenedor) contenedor.classList.add('d-none');
}


// ── Sidebar: avatar y nombre ──────────────────────────────────────────────────

/**
 * Carga el avatar y nombre en el sidebar usando la API de perfil, y
 * ajusta el botón "Registrar mi parqueadero" de la navbar según si
 * el conductor ya tiene uno registrado.
 */
async function cargarAvatarSidebar() {
    try {
        const res = await fetch('/api/usuario/perfil', { credentials: 'same-origin' });
        if (!res.ok) return;
        const usuario = await res.json();
        const nombreCompleto = `${usuario.nombres} ${usuario.apellidos}`;
        const seed = encodeURIComponent(nombreCompleto);
        const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${seed}&backgroundColor=1a3c5e&fontSize=38&fontWeight=600`;

        const avatar = document.getElementById('sidebarAvatar');
        const nombre = document.getElementById('sidebarName');
        if (avatar) { avatar.src = avatarUrl; avatar.alt = nombreCompleto; }
        if (nombre) nombre.textContent = nombreCompleto;

        _idParqueaderoDelUsuario = usuario.id_parqueadero;
        const btn = document.getElementById('btnRegistrarParqueadero');
        if (btn) {
            const icono = btn.querySelector('.material-symbols-outlined');
            const texto = document.getElementById('txtBotonParqueadero');
            if (usuario.id_parqueadero) {
                btn.title = 'Ir a mi parqueadero';
                if (icono) icono.textContent = 'storefront';
                if (texto) texto.textContent = 'Mi Parqueadero';
            } else {
                btn.title = 'Registrar mi parqueadero';
                if (icono) icono.textContent = 'add_business';
                if (texto) texto.textContent = 'Registrar parqueadero';
            }
        }
    } catch (_) { }
}


// ── Cierre de sesión ──────────────────────────────────────────────────────────

async function cerrarSesion() {
    try {
        await fetch('/api/usuario/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
        window.location.href = '/login';
    }
}