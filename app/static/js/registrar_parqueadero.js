/**
 * registrar_parqueadero.js — RF_10 / RF_05
 * Maneja la captura de ubicación con Leaflet y el envío del formulario.
 * Al completarse exitosamente el backend asigna el rol Administrador (RF_05)
 * y redirige al panel de administrador.
 */

let mapaRegistro = null;
let marcadorRegistro = null;

document.addEventListener('DOMContentLoaded', function () {

    const form = document.getElementById('formRegistrarParqueadero');
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            await registrarParqueadero();
        });
    }

    const btnUbicacion = document.getElementById('btnCapturarUbicacion');
    if (btnUbicacion) {
        btnUbicacion.addEventListener('click', capturarUbicacion);
    }
});


// ── Geolocalización y mapa embebido ──────────────────────────────────────────

/**
 * Solicita la ubicación actual del navegador.
 * Si se obtiene, inicializa el mapa y coloca el marcador arrastrable.
 */
function capturarUbicacion() {
    const btn = document.getElementById('btnCapturarUbicacion');

    if (!navigator.geolocation) {
        mostrarError(
            'Ubicación no disponible',
            'Tu navegador no soporta la geolocalización. Actualiza el navegador e intenta de nuevo.'
        );
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `
        <span class="material-symbols-outlined">sync</span>
        Obteniendo ubicación...
    `;

    navigator.geolocation.getCurrentPosition(
        function (posicion) {
            const lat = posicion.coords.latitude;
            const lng = posicion.coords.longitude;

            guardarCoordenadas(lat, lng);
            mostrarMapa(lat, lng);

            btn.innerHTML = `
                <span class="material-symbols-outlined">check_circle</span>
                Ubicación capturada — clic para recapturar
            `;
            btn.disabled = false;
        },
        function (error) {
            btn.disabled = false;
            btn.innerHTML = `
                <span class="material-symbols-outlined">my_location</span>
                Usar mi ubicación actual
            `;

            if (error.code === 1) {
                mostrarError(
                    'Permiso denegado',
                    'Debes permitir el acceso a tu ubicación en el navegador para registrar el parqueadero.'
                );
            } else if (error.code === 2) {
                mostrarError(
                    'Ubicación no disponible',
                    'No se pudo obtener tu ubicación. Verifica que el GPS esté activo e intenta de nuevo.'
                );
            } else {
                mostrarError(
                    'Tiempo de espera agotado',
                    'La solicitud de ubicación tardó demasiado. Intenta de nuevo.'
                );
            }
        },
        { timeout: 12000, maximumAge: 0, enableHighAccuracy: true }
    );
}

/**
 * Inicializa o actualiza el mapa Leaflet embebido con un marcador arrastrable.
 * Al arrastrar el marcador se actualizan los campos ocultos de coordenadas.
 * @param {number} lat
 * @param {number} lng
 */
function mostrarMapa(lat, lng) {
    const contenedor = document.getElementById('contenedorMapa');
    contenedor.classList.remove('d-none');

    if (mapaRegistro) {
        // El mapa ya existe — reposiciona el marcador y centra la vista
        mapaRegistro.setView([lat, lng], 17);
        marcadorRegistro.setLatLng([lat, lng]);
        guardarCoordenadas(lat, lng);
        return;
    }

    mapaRegistro = L.map('mapRegistro', {
        center: [lat, lng],
        zoom: 17,
        zoomControl: true
    });

    L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19 }
    ).addTo(mapaRegistro);

    marcadorRegistro = L.marker([lat, lng], { draggable: true }).addTo(mapaRegistro);

    // Al arrastrar el marcador se actualizan las coordenadas ocultas
    marcadorRegistro.on('dragend', function () {
        const pos = marcadorRegistro.getLatLng();
        guardarCoordenadas(pos.lat, pos.lng);
    });

    // Fuerza a Leaflet a recalcular el tamaño del contenedor
    // ya que el div estaba oculto con d-none al inicializar
    setTimeout(() => mapaRegistro.invalidateSize(), 100);
}

/**
 * Almacena latitud y longitud en los campos ocultos del formulario.
 * @param {number} lat
 * @param {number} lng
 */
function guardarCoordenadas(lat, lng) {
    document.getElementById('inputLatitud').value = lat;
    document.getElementById('inputLongitud').value = lng;
}


// ── Envío del formulario ──────────────────────────────────────────────────────

async function registrarParqueadero() {
    const btnGuardar = document.getElementById('btnRegistrarParqueadero');

    const nit = document.getElementById('inputNit').value.trim();
    const nombre = document.getElementById('inputNombre').value.trim();
    const direccion = document.getElementById('inputDireccion').value.trim();
    const correo = document.getElementById('inputCorreo').value.trim();
    const telefono = document.getElementById('inputTelefono').value.trim();
    const capacidad = document.getElementById('inputCapacidad').value.trim();
    const latitud = document.getElementById('inputLatitud').value.trim();
    const longitud = document.getElementById('inputLongitud').value.trim();

    if (!nombre || !direccion || !correo || !telefono || !capacidad) {
        mostrarAdvertencia('Campos incompletos', 'Por favor completa todos los campos obligatorios.');
        return;
    }

    if (!latitud || !longitud) {
        mostrarAdvertencia(
            'Ubicación requerida',
            'Debes capturar la ubicación del parqueadero antes de registrarlo.'
        );
        return;
    }

    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Registrando...';

    try {
        const res = await fetch('/api/parqueadero/registrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                nit: nit || null,
                nombre,
                direccion,
                correo,
                telefono,
                capacidad_total: parseInt(capacidad),
                latitud: parseFloat(latitud),
                longitud: parseFloat(longitud)
            })
        });

        const datos = await res.json();

        if (res.ok) {
            await Swal.fire({
                title: '¡Parqueadero registrado!',
                text: 'Tu parqueadero está activo. Ahora eres Administrador.',
                icon: 'success',
                background: '#001f2e',
                color: '#cfe9ff',
                iconColor: '#91f78e',
                confirmButtonColor: '#91f78e',
                confirmButtonText: 'Ir a mi panel',
                didOpen: () => {
                    const popup = Swal.getPopup();
                    if (popup) {
                        popup.style.border = '2px solid #91f78e';
                        popup.style.borderRadius = '12px';
                    }
                    estilizarBotonSwal();
                }
            });
            window.location.href = '/administrador/perfil';
        } else {
            mostrarError('Error', datos.error);
        }

    } catch (_) {
        mostrarError(
            'Error de conexión',
            'No se pudo conectar con el servidor. Intenta de nuevo.'
        );
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.textContent = 'Registrar parqueadero';
    }
}


// ── Utilidades SweetAlert2 ────────────────────────────────────────────────────

function mostrarError(titulo, texto) {
    Swal.fire({
        title: titulo,
        text: texto,
        icon: 'error',
        background: '#001f2e',
        color: '#cfe9ff',
        iconColor: '#ff5252',
        confirmButtonColor: '#91f78e',
        confirmButtonText: 'Entendido',
        didOpen: () => {
            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #ff5252';
                popup.style.borderRadius = '12px';
            }
            estilizarBotonSwal();
        }
    });
}

function mostrarAdvertencia(titulo, texto) {
    Swal.fire({
        title: titulo,
        text: texto,
        icon: 'warning',
        background: '#001f2e',
        color: '#cfe9ff',
        iconColor: '#ffb74d',
        confirmButtonColor: '#91f78e',
        confirmButtonText: 'Entendido',
        didOpen: () => {
            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #ffb74d';
                popup.style.borderRadius = '12px';
            }
            estilizarBotonSwal();
        }
    });
}

function estilizarBotonSwal() {
    const btn = Swal.getConfirmButton();
    if (btn) {
        btn.style.borderRadius = '8px';
        btn.style.color = '#00101b';
        btn.style.fontWeight = '700';
    }
}