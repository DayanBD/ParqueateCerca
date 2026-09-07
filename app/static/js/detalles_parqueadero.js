/**
 * detalles_parqueadero.js — Vista de detalle del parqueadero (conductor)
 * RF_10/RF_11/RF_12/RF_13 en modo lectura + RF_19/RF_20 (reseñas).
 */

const ICONOS_POR_VEHICULO = {
    'Automóvil': 'directions_car',
    'Motocicleta': 'two_wheeler',
    'Bicicleta': 'pedal_bike',
    'Camión': 'local_shipping',
    'Bus': 'directions_bus'
};

const ICONOS_POR_SERVICIO = { 'Taller': 'build', 'Lavado': 'local_car_wash', 'Restaurante': 'restaurant' };

let idParqueadero = null;
let detalleActual = null;
let miCalificacion = null;
let valorSeleccionado = 0;

document.addEventListener('DOMContentLoaded', function () {
    idParqueadero = document.getElementById('mainContent').dataset.idParqueadero;

    // ── Sidebar ───────────────────────────────────────────────────────────────
    const btnToggle = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    if (btnToggle && sidebar) {
        btnToggle.addEventListener('click', function () {
            sidebar.classList.toggle('expanded');
            if (mainContent) mainContent.classList.toggle('expanded');
        });
    }

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

    // ── Selector de estrellas del modal ──────────────────────────────────────
    document.querySelectorAll('.estrella-input').forEach(function (btn) {
        btn.addEventListener('click', function () {
            seleccionarEstrellas(parseInt(btn.dataset.valor));
        });
    });

    document.getElementById('inputResenaTexto')
        ?.addEventListener('input', actualizarContadorResena);

    document.getElementById('btnEnviarResena')
        ?.addEventListener('click', enviarResena);

    cargarAvatarSidebar();
    cargarDetalleParqueadero();
});


// ── Sidebar: avatar y nombre ────────────────────────────────────────────────

async function cargarAvatarSidebar() {
    try {
        const res = await fetch('/api/usuario/perfil', { credentials: 'same-origin' });
        if (!res.ok) return;
        const usuario = await res.json();
        const nombreCompleto = `${usuario.nombres} ${usuario.apellidos}`;
        const seed = encodeURIComponent(nombreCompleto);
        const avatar = document.getElementById('sidebarAvatar');
        const nombre = document.getElementById('sidebarName');
        if (avatar) {
            avatar.src = `https://api.dicebear.com/9.x/initials/svg?seed=${seed}&backgroundColor=1a3c5e&fontSize=38&fontWeight=600`;
            avatar.alt = nombreCompleto;
        }
        if (nombre) nombre.textContent = nombreCompleto;
    } catch (_) { }
}

async function cerrarSesion() {
    try {
        await fetch('/api/usuario/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
        window.location.href = '/login';
    }
}


// ── Carga principal ───────────────────────────────────────────────────────────

async function cargarDetalleParqueadero() {
    try {
        const [resDetalle, resResenas] = await Promise.all([
            fetch(`/api/parqueaderos/${idParqueadero}`, { credentials: 'same-origin' }),
            fetch(`/api/parqueaderos/${idParqueadero}/calificaciones`, { credentials: 'same-origin' })
        ]);

        if (resDetalle.status === 401 || resResenas.status === 401) {
            window.location.href = '/login';
            return;
        }

        if (!resDetalle.ok) {
            mostrarErrorCarga();
            return;
        }

        detalleActual = await resDetalle.json();
        const datosResenas = resResenas.ok ? await resResenas.json() : { calificaciones: [], propia: null };
        miCalificacion = datosResenas.propia;

        poblarCarrusel();
        poblarEncabezado();
        poblarInfo();
        poblarCupos();
        poblarServicios();
        poblarResenas(datosResenas.calificaciones);
        actualizarBotonResena();

        document.getElementById('loaderDetalle').classList.add('d-none');
        document.getElementById('contenidoDetalle').classList.remove('d-none');

    } catch (_) {
        mostrarErrorCarga();
    }
}

function mostrarErrorCarga() {
    document.getElementById('loaderDetalle').classList.add('d-none');
    swalError('No se pudo cargar', 'Este parqueadero no existe o ya no está disponible.')
        .then(() => window.location.href = '/conductor/mapa');
}


// ── Carrusel de fotos ─────────────────────────────────────────────────────────

function poblarCarrusel() {
    const inner = document.getElementById('carruselInner');
    const indicadores = document.getElementById('carruselIndicadores');
    inner.innerHTML = '';
    indicadores.innerHTML = '';

    if (!detalleActual.fotos.length) {
        inner.innerHTML = `
            <div class="carousel-item active">
                <div class="sin-fotos">
                    <span class="material-symbols-outlined">no_photography</span>
                    Sin fotos disponibles
                </div>
            </div>
        `;
        return;
    }

    detalleActual.fotos.forEach(function (foto, i) {
        const item = document.createElement('div');
        item.className = `carousel-item${i === 0 ? ' active' : ''}`;
        item.innerHTML = `<img src="/static/${foto.ruta_archivo}" alt="Foto del parqueadero">`;
        inner.appendChild(item);

        const indicador = document.createElement('button');
        indicador.type = 'button';
        indicador.dataset.bsTarget = '#carruselFotos';
        indicador.dataset.bsSlideTo = i;
        if (i === 0) indicador.className = 'active';
        indicadores.appendChild(indicador);
    });
}


// ── Encabezado (nombre, calificación, dirección, cupos libres) ───────────────

function poblarEncabezado() {
    document.getElementById('detNombre').textContent = detalleActual.nombre;
    document.getElementById('detDireccion').textContent = detalleActual.direccion;

    const totalDisponible = detalleActual.cupos.reduce((sum, c) => sum + c.cupo_disponible, 0);
    document.getElementById('detCuposLibres').textContent = totalDisponible;

    const promedio = detalleActual.promedio_calificacion;
    const total = detalleActual.total_calificaciones;
    const contenedorEstrellas = document.getElementById('detEstrellas');
    contenedorEstrellas.innerHTML = dibujarEstrellas(Math.round(promedio));

    document.getElementById('detPromedioTexto').textContent = total > 0
        ? `${promedio.toFixed(1)} (${total} ${total === 1 ? 'reseña' : 'reseñas'})`
        : 'Sin calificaciones aún';
}

/** Genera el HTML de 3 íconos de estrella, llenando 'cantidad' de ellas. */
function dibujarEstrellas(cantidad) {
    let html = '';
    for (let i = 1; i <= 3; i++) {
        html += `<span class="material-symbols-outlined${i <= cantidad ? ' llena' : ''}">star</span>`;
    }
    return html;
}


// ── Información general ──────────────────────────────────────────────────────

function poblarInfo() {
    document.getElementById('detDescripcion').textContent =
        detalleActual.descripcion || 'Este parqueadero aún no agregó una descripción.';
    document.getElementById('detTelefono').textContent = detalleActual.telefono;
    document.getElementById('detCorreo').textContent = detalleActual.correo;

    const h = detalleActual.horario_general;
    document.getElementById('detHorarioGeneral').textContent = h
        ? `${formatoRangoDias(h.dia_inicial, h.dia_final)} • ${formatoHora12(h.hora_inicial)} - ${formatoHora12(h.hora_final)}`
        : 'Horario no definido';
}

function formatoRangoDias(inicial, final) {
    return inicial === final ? inicial : `${inicial} a ${final}`;
}

/** Convierte 'HH:MM' 24h a formato de 12 horas con AM/PM. */
function formatoHora12(horaTexto) {
    if (!horaTexto) return '—';
    const [h, m] = horaTexto.split(':').map(Number);
    const periodo = h >= 12 ? 'PM' : 'AM';
    const hora12 = h % 12 === 0 ? 12 : h % 12;
    return `${hora12}:${String(m).padStart(2, '0')} ${periodo}`;
}


// ── Cupos por tipo de vehículo ────────────────────────────────────────────────

function poblarCupos() {
    const contenedor = document.getElementById('cuposDetalle');
    contenedor.innerHTML = '';

    detalleActual.cupos.forEach(function (cupo) {
        const lleno = cupo.cupo_disponible === 0;
        const col = document.createElement('div');
        col.className = 'col-6 col-md-4';
        col.innerHTML = `
            <div class="cupo-card">
                <span class="material-symbols-outlined">${ICONOS_POR_VEHICULO[cupo.descripcion] || 'directions_car'}</span>
                <div>
                    <span class="cupo-card-nombre">${cupo.descripcion}</span>
                    <span class="cupo-card-valor${lleno ? ' lleno' : ''}">
                        ${lleno ? 'Sin cupos' : `${cupo.cupo_disponible} de ${cupo.cupo_total} libres`}
                    </span>
                </div>
            </div>
        `;
        contenedor.appendChild(col);
    });
}


// ── Servicios adicionales ────────────────────────────────────────────────────

function poblarServicios() {
    const bloque = document.getElementById('serviciosBloque');
    const contenedor = document.getElementById('serviciosDetalle');
    contenedor.innerHTML = '';

    if (!detalleActual.servicios.length) {
        bloque.classList.add('d-none');
        return;
    }
    bloque.classList.remove('d-none');

    detalleActual.servicios.forEach(function (servicio) {
        const tieneHorarioPropio = servicio.dia_inicial && servicio.hora_inicial;
        const col = document.createElement('div');
        col.className = 'col-md-6';
        col.innerHTML = `
            <div class="servicio-card">
                <div class="servicio-card-titulo">
                    <span class="material-symbols-outlined">${ICONOS_POR_SERVICIO[servicio.descripcion] || 'star'}</span>
                    ${servicio.descripcion}
                </div>
                <p class="servicio-card-horario">
                    ${tieneHorarioPropio
                ? `${formatoRangoDias(servicio.dia_inicial, servicio.dia_final)} • ${formatoHora12(servicio.hora_inicial)} - ${formatoHora12(servicio.hora_final)}`
                : 'Mismo horario del parqueadero'}
                </p>
            </div>
        `;
        contenedor.appendChild(col);
    });
}


// ── Reseñas (RF_19 / RF_20) ────────────────────────────────────────────────────

function poblarResenas(calificaciones) {
    const contenedor = document.getElementById('listaResenas');
    contenedor.innerHTML = '';

    if (!calificaciones.length) {
        contenedor.innerHTML = '<p class="sin-resenas">Todavía no hay reseñas para este parqueadero.</p>';
        return;
    }

    calificaciones.forEach(function (cal) {
        // Se muestra solo la inicial del apellido por privacidad del conductor.
        const nombreVisible = `${cal.nombres} ${cal.apellidos.charAt(0)}.`;
        const item = document.createElement('div');
        item.className = 'resena-item';
        item.innerHTML = `
            <div class="resena-avatar">${cal.nombres.charAt(0)}</div>
            <div>
                <div class="resena-cabecera">
                    <span class="resena-autor">${nombreVisible}</span>
                    <span class="estrellas">${dibujarEstrellas(cal.valor)}</span>
                    <span class="resena-fecha">${new Date(cal.fecha_calificacion).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <p class="resena-comentario">${cal.resena || 'Sin comentario.'}</p>
            </div>
        `;
        contenedor.appendChild(item);
    });
}

/** Ajusta el texto del botón y el modal según si el conductor ya calificó. */
function actualizarBotonResena() {
    const txtBoton = document.getElementById('txtBotonResena');
    const tituloModal = document.getElementById('tituloModalResena');

    if (miCalificacion) {
        txtBoton.textContent = 'Editar mi reseña';
        tituloModal.textContent = 'Editar tu reseña';
        seleccionarEstrellas(miCalificacion.valor);
        document.getElementById('inputResenaTexto').value = miCalificacion.resena || '';
    } else {
        txtBoton.textContent = 'Dejar reseña';
        tituloModal.textContent = 'Calificar parqueadero';
        seleccionarEstrellas(0);
        document.getElementById('inputResenaTexto').value = '';
    }
    actualizarContadorResena();
}

function seleccionarEstrellas(valor) {
    valorSeleccionado = valor;
    document.querySelectorAll('.estrella-input').forEach(function (btn) {
        btn.classList.toggle('activa', parseInt(btn.dataset.valor) <= valor);
    });
}

function actualizarContadorResena() {
    const texto = document.getElementById('inputResenaTexto').value;
    document.getElementById('contadorResena').textContent = texto.length;
}

async function enviarResena() {
    if (valorSeleccionado < 1) {
        swalAdvertencia('Selecciona una calificación', 'Elige de 1 a 3 estrellas antes de enviar tu reseña.');
        return;
    }

    const btn = document.getElementById('btnEnviarResena');
    btn.disabled = true;

    try {
        const res = await fetch(`/api/parqueaderos/${idParqueadero}/calificaciones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                valor: valorSeleccionado,
                resena: document.getElementById('inputResenaTexto').value.trim()
            })
        });
        const datos = await res.json();

        if (res.status === 403) {
            bootstrap.Modal.getInstance(document.getElementById('modalResena'))?.hide();
            swalAdvertencia('Aún no puedes calificar', datos.error);
            return;
        }

        if (!res.ok) {
            swalError('Error', datos.error || 'No se pudo guardar tu reseña.');
            return;
        }

        bootstrap.Modal.getInstance(document.getElementById('modalResena'))?.hide();
        await cargarDetalleParqueadero();
        swalExito('Reseña guardada', 'Gracias por calificar este parqueadero.');

    } catch (_) {
        swalError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
        btn.disabled = false;
    }
}


// ── Helpers SweetAlert2 (mismo estilo de vehiculos.js) ────────────────────────

function swalExito(titulo, texto) {
    return Swal.fire({
        title: titulo,
        text: texto,
        icon: 'success',
        background: '#001f2e',
        color: '#e0e0e0',
        confirmButtonColor: '#91f78e',
        didOpen: () => {
            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #91f78e';
                popup.style.borderRadius = '12px';
            }
            const confirmBtn = Swal.getConfirmButton();
            if (confirmBtn) {
                confirmBtn.style.borderRadius = '8px';
                confirmBtn.style.color = '#00101b';
                confirmBtn.style.fontSize = '1rem';
            }
        }
    });
}

function swalError(titulo, texto) {
    return Swal.fire({
        title: titulo,
        text: texto,
        icon: 'error',
        background: '#001f2e',
        color: '#e0e0e0',
        confirmButtonColor: '#91f78e',
        didOpen: () => {
            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #ff5252';
                popup.style.borderRadius = '12px';
            }
            const confirmBtn = Swal.getConfirmButton();
            if (confirmBtn) {
                confirmBtn.style.borderRadius = '8px';
                confirmBtn.style.color = '#00101b';
                confirmBtn.style.fontSize = '1rem';
            }
        }
    });
}

function swalAdvertencia(titulo, texto) {
    return Swal.fire({
        title: titulo,
        text: texto,
        icon: 'warning',
        background: '#001f2e',
        color: '#e0e0e0',
        confirmButtonColor: '#91f78e',
        didOpen: () => {
            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #ffb74d';
                popup.style.borderRadius = '12px';
            }
            const confirmBtn = Swal.getConfirmButton();
            if (confirmBtn) {
                confirmBtn.style.borderRadius = '8px';
                confirmBtn.style.color = '#00101b';
                confirmBtn.style.fontSize = '1rem';
            }
        }
    });
}