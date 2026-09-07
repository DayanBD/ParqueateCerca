/**
 * perfil_parqueadero.js — RF_10 / RF_11 / RF_12 / RF_13
 * Controla las 4 pestañas del perfil del parqueadero: datos
 * generales (con mapa Leaflet reutilizado del registro), cupos por
 * tipo de vehículo, horarios y servicios, y galería de fotos.
 *
 * El toggle del sidebar, el avatar y el logout los maneja
 * dashboard.js; este archivo solo gestiona el contenido de esta vista.
 */

const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const ICONOS_POR_VEHICULO = {
    'Automóvil': 'directions_car',
    'Motocicleta': 'two_wheeler',
    'Bicicleta': 'pedal_bike',
    'Camión': 'local_shipping',
    'Bus': 'directions_bus'
};
function iconoVehiculo(descripcion) {
    return ICONOS_POR_VEHICULO[descripcion] || 'directions_car';
}

const ICONOS_POR_SERVICIO = { 'Taller': 'build', 'Lavado': 'local_car_wash', 'Restaurante': 'restaurant' };

// Estado en memoria del perfil cargado, para no volver a pedirlo
// entre pestañas y para poder recalcular sumas de cupos en vivo
let perfilActual = null;
let catalogoServicios = [];

let mapaPerfil = null;
let marcadorPerfil = null;

document.addEventListener('DOMContentLoaded', function () {
    cargarPerfilParqueadero();

    document.getElementById('formDatosGenerales')
        ?.addEventListener('submit', function (e) { e.preventDefault(); guardarDatosGenerales(); });

    document.getElementById('btnUbicacionActual')
        ?.addEventListener('click', capturarUbicacionActual);

    document.getElementById('formCupos')
        ?.addEventListener('submit', function (e) { e.preventDefault(); guardarCupos(); });

    document.getElementById('formHorariosServicios')
        ?.addEventListener('submit', function (e) { e.preventDefault(); guardarHorariosServicios(); });

    document.getElementById('inputDescripcion')
        ?.addEventListener('input', actualizarContadorDescripcion);

    document.getElementById('inputFoto')
        ?.addEventListener('change', subirFoto);
});


// ── Carga inicial ─────────────────────────────────────────────────────────────

/**
 * Carga los datos del parqueadero y el catálogo de servicios, y
 * puebla las 4 pestañas. Se hace en paralelo para no encadenar
 * tiempos de espera innecesarios.
 */
async function cargarPerfilParqueadero() {
    try {
        const [resPerfil, resServicios] = await Promise.all([
            fetch('/api/parqueadero/perfil', { method: 'GET', credentials: 'same-origin' }),
            fetch('/api/servicios/tipos', { method: 'GET', credentials: 'same-origin' })
        ]);

        if (!resPerfil.ok || !resServicios.ok) {
            throw new Error('Respuesta no exitosa del servidor');
        }

        perfilActual = await resPerfil.json();
        catalogoServicios = await resServicios.json();

        poblarDatosGenerales();
        poblarCupos();
        poblarDiasSelect();
        poblarHorarioGeneral();
        poblarServicios();
        poblarGaleriaFotos();

    } catch (_) {
        mostrarError('Error al cargar', 'No se pudo obtener la información del parqueadero. Intenta de nuevo.');
    }
}


// ── Tab: Datos generales ────────────────────────────────────────────────────

function poblarDatosGenerales() {
    document.getElementById('inputNombre').value = perfilActual.nombre || '';
    document.getElementById('inputDireccion').value = perfilActual.direccion || '';
    document.getElementById('inputTelefono').value = perfilActual.telefono || '';
    document.getElementById('inputCorreo').value = perfilActual.correo || '';
    document.getElementById('inputDescripcion').value = perfilActual.descripcion || '';
    document.getElementById('inputLatitud').value = perfilActual.latitud;
    document.getElementById('inputLongitud').value = perfilActual.longitud;

    actualizarContadorDescripcion();
    inicializarMapaPerfil(parseFloat(perfilActual.latitud), parseFloat(perfilActual.longitud));
}

function actualizarContadorDescripcion() {
    const texto = document.getElementById('inputDescripcion').value;
    document.getElementById('contadorDescripcion').textContent = texto.length;
}

/**
 * Inicializa el mapa Leaflet con un marcador arrastrable en la
 * posición actual del parqueadero. Al soltar el marcador se
 * actualizan los campos ocultos de latitud/longitud.
 * @param {number} lat
 * @param {number} lng
 */
function inicializarMapaPerfil(lat, lng) {
    mapaPerfil = L.map('mapaPerfil', { center: [lat, lng], zoom: 17, zoomControl: true });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapaPerfil);

    marcadorPerfil = L.marker([lat, lng], { draggable: true }).addTo(mapaPerfil);
    marcadorPerfil.on('dragend', function () {
        const pos = marcadorPerfil.getLatLng();
        document.getElementById('inputLatitud').value = pos.lat;
        document.getElementById('inputLongitud').value = pos.lng;
    });

    // El contenedor está oculto hasta que Bootstrap active la pestaña
    // la primera vez; recalcula el tamaño cuando eso ocurra
    document.getElementById('tab-datos-btn').addEventListener('shown.bs.tab', function () {
        setTimeout(() => mapaPerfil.invalidateSize(), 50);
    });
}

function capturarUbicacionActual() {
    if (!navigator.geolocation) {
        mostrarError('No disponible', 'Tu navegador no soporta geolocalización.');
        return;
    }
    const btn = document.getElementById('btnUbicacionActual');
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        function (posicion) {
            const { latitude, longitude } = posicion.coords;
            marcadorPerfil.setLatLng([latitude, longitude]);
            mapaPerfil.setView([latitude, longitude], 17);
            document.getElementById('inputLatitud').value = latitude;
            document.getElementById('inputLongitud').value = longitude;
            btn.disabled = false;
        },
        function (error) {
            btn.disabled = false;
            if (error.code === error.PERMISSION_DENIED) {
                mostrarAdvertencia('Ubicación desactivada', 'Activa los permisos de ubicación del navegador para usar esta función.');
            } else {
                mostrarError('Error de ubicación', 'No se pudo obtener tu posición actual.');
            }
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

async function guardarDatosGenerales() {
    const btn = document.getElementById('btnGuardarDatos');
    btn.disabled = true;

    const payload = {
        nombre: document.getElementById('inputNombre').value.trim(),
        direccion: document.getElementById('inputDireccion').value.trim(),
        correo: document.getElementById('inputCorreo').value.trim(),
        telefono: document.getElementById('inputTelefono').value.trim(),
        descripcion: document.getElementById('inputDescripcion').value.trim(),
        latitud: document.getElementById('inputLatitud').value,
        longitud: document.getElementById('inputLongitud').value
    };

    try {
        const res = await fetch('/api/parqueadero/datos', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const datos = await res.json();

        if (!res.ok) {
            mostrarError('Error', datos.error || 'No se pudieron guardar los datos.');
            return;
        }

        mostrarExito('Datos guardados', 'La información general del parqueadero fue actualizada.');

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
        btn.disabled = false;
    }
}


// ── Tab: Cupos ───────────────────────────────────────────────────────────────

function poblarCupos() {
    const contenedor = document.getElementById('listaCupos');
    contenedor.innerHTML = '';

    perfilActual.cupos.forEach(function (cupo) {
        const fila = document.createElement('div');
        fila.className = 'fila-cupo';
        fila.innerHTML = `
            <div class="fila-cupo-info">
                <span class="material-symbols-outlined">${iconoVehiculo(cupo.descripcion)}</span>
                <div>
                    <span class="fila-cupo-nombre">${cupo.descripcion}</span>
                    <span class="fila-cupo-ocupado">${cupo.cupo_ocupado} ocupados actualmente</span>
                </div>
            </div>
            <input type="number" class="field-control input-cupo" min="${cupo.cupo_ocupado}"
                data-id-tipo="${cupo.id_tipo_vehiculo}" value="${cupo.cupo_total}">
        `;
        contenedor.appendChild(fila);
    });

    document.getElementById('inputCapacidadTotal').value = perfilActual.capacidad_total;

    document.querySelectorAll('.input-cupo').forEach(function (input) {
        input.addEventListener('input', actualizarResumenCupos);
    });
    document.getElementById('inputCapacidadTotal').addEventListener('input', actualizarResumenCupos);

    actualizarResumenCupos();
}

/**
 * Recalcula la suma de cupos asignados y el restante contra la
 * capacidad total, en vivo mientras el administrador edita.
 */
function actualizarResumenCupos() {
    const inputs = document.querySelectorAll('.input-cupo');
    let asignado = 0;
    inputs.forEach(function (input) {
        asignado += parseInt(input.value) || 0;
    });

    const capacidad = parseInt(document.getElementById('inputCapacidadTotal').value) || 0;
    const restante = capacidad - asignado;

    document.getElementById('resumenAsignado').textContent = asignado;
    document.getElementById('resumenRestante').textContent = restante;

    const contenedorResumen = document.querySelector('.resumen-cupos');
    const btnGuardar = document.getElementById('btnGuardarCupos');
    contenedorResumen.classList.toggle('excedido', restante < 0);
    btnGuardar.disabled = restante < 0;
}

async function guardarCupos() {
    const btn = document.getElementById('btnGuardarCupos');
    btn.disabled = true;

    const capacidadTotal = parseInt(document.getElementById('inputCapacidadTotal').value) || 0;
    const cupos = Array.from(document.querySelectorAll('.input-cupo')).map(function (input) {
        return {
            id_tipo_vehiculo: parseInt(input.dataset.idTipo),
            cupo_total: parseInt(input.value) || 0
        };
    });

    try {
        const res = await fetch('/api/parqueadero/cupos', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ cupos, capacidad_total: capacidadTotal })
        });
        const datos = await res.json();

        if (!res.ok) {
            mostrarError('Error', datos.error || 'No se pudieron guardar los cupos.');
            btn.disabled = false;
            return;
        }

        mostrarExito('Cupos guardados', 'La distribución de cupos fue actualizada.');
        btn.disabled = false;

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
        btn.disabled = false;
    }
}


// ── Tab: Horarios y servicios ───────────────────────────────────────────────

function poblarDiasSelect() {
    const selects = [document.getElementById('selectDiaInicial'), document.getElementById('selectDiaFinal')];
    selects.forEach(function (select) {
        select.innerHTML = DIAS_SEMANA.map(dia => `<option value="${dia}">${dia}</option>`).join('');
    });
}

function poblarHorarioGeneral() {
    const horario = perfilActual.horario_general;
    if (!horario) return;

    document.getElementById('selectDiaInicial').value = horario.dia_inicial;
    document.getElementById('selectDiaFinal').value = horario.dia_final;
    document.getElementById('inputHoraInicial').value = horario.hora_inicial?.slice(0, 5) || '';
    document.getElementById('inputHoraFinal').value = horario.hora_final?.slice(0, 5) || '';
}

/**
 * Pinta un checkbox por cada servicio del catálogo. Si el
 * parqueadero ya tiene ese servicio activo, lo marca y, si además
 * tiene horario propio, activa el toggle correspondiente con sus
 * valores precargados.
 */
function poblarServicios() {
    const contenedor = document.getElementById('listaServicios');
    contenedor.innerHTML = '';

    catalogoServicios.forEach(function (servicio) {
        const activo = perfilActual.servicios.find(s => s.id_tipo_servicio === servicio.id_tipo_servicio);
        const tieneHorarioPropio = !!(activo && activo.dia_inicial);

        const item = document.createElement('div');
        item.className = 'item-servicio';
        item.innerHTML = `
            
            <div class="item-servicio-cabecera">
                <span class="material-symbols-outlined item-servicio-icono">${ICONOS_POR_SERVICIO[servicio.descripcion] || 'category'}</span>
                <label class="item-servicio-nombre" for="servicio-${servicio.id_tipo_servicio}">${servicio.descripcion}</label>
                <label class="switch-toggle">
                    <input type="checkbox" class="chk-servicio" id="servicio-${servicio.id_tipo_servicio}"
                        data-id-servicio="${servicio.id_tipo_servicio}" ${activo ? 'checked' : ''}>
                    <span class="switch-slider"></span>
                </label>
            </div>

            <div class="item-servicio-toggle-horario" data-bloque-toggle style="${activo ? '' : 'display:none;'}">
                <input type="checkbox" class="chk-horario-propio" id="toggle-horario-${servicio.id_tipo_servicio}"
                    ${tieneHorarioPropio ? 'checked' : ''}>
                <label for="toggle-horario-${servicio.id_tipo_servicio}">
                    Este servicio tiene un horario distinto al del parqueadero
                </label>
            </div>

            <div class="item-servicio-horario-propio" data-bloque-horario
                style="${tieneHorarioPropio ? '' : 'display:none;'}">
                <div class="row g-2">
                    <div class="col-6 col-md-3">
                        <label class="field-label">Día inicial</label>
                        <select class="field-control select-dia-inicial-propio"></select>
                    </div>
                    <div class="col-6 col-md-3">
                        <label class="field-label">Día final</label>
                        <select class="field-control select-dia-final-propio"></select>
                    </div>
                    <div class="col-6 col-md-3">
                        <label class="field-label">Apertura</label>
                        <input type="time" class="field-control input-hora-inicial-propio">
                    </div>
                    <div class="col-6 col-md-3">
                        <label class="field-label">Cierre</label>
                        <input type="time" class="field-control input-hora-final-propio">
                    </div>
                </div>
            </div>
        `;
        contenedor.appendChild(item);

        // Puebla los selects de días de este servicio y precarga sus valores
        const selectDiaIni = item.querySelector('.select-dia-inicial-propio');
        const selectDiaFin = item.querySelector('.select-dia-final-propio');
        selectDiaIni.innerHTML = DIAS_SEMANA.map(dia => `<option value="${dia}">${dia}</option>`).join('');
        selectDiaFin.innerHTML = DIAS_SEMANA.map(dia => `<option value="${dia}">${dia}</option>`).join('');

        if (tieneHorarioPropio) {
            selectDiaIni.value = activo.dia_inicial;
            selectDiaFin.value = activo.dia_final;
            item.querySelector('.input-hora-inicial-propio').value = activo.hora_inicial?.slice(0, 5) || '';
            item.querySelector('.input-hora-final-propio').value = activo.hora_final?.slice(0, 5) || '';
        }

        // Mostrar/ocultar el toggle de horario propio según el checkbox principal
        const chkServicio = item.querySelector('.chk-servicio');
        const bloqueToggle = item.querySelector('[data-bloque-toggle]');
        chkServicio.addEventListener('change', function () {
            bloqueToggle.style.display = chkServicio.checked ? '' : 'none';
            if (!chkServicio.checked) {
                item.querySelector('.chk-horario-propio').checked = false;
                item.querySelector('[data-bloque-horario]').style.display = 'none';
            }
        });

        // Mostrar/ocultar el mini formulario de horario propio
        const chkHorarioPropio = item.querySelector('.chk-horario-propio');
        const bloqueHorario = item.querySelector('[data-bloque-horario]');
        chkHorarioPropio.addEventListener('change', function () {
            bloqueHorario.style.display = chkHorarioPropio.checked ? '' : 'none';
        });
    });
}

async function guardarHorariosServicios() {
    const btn = document.getElementById('btnGuardarHorarios');
    btn.disabled = true;

    const horarioGeneral = {
        dia_inicial: document.getElementById('selectDiaInicial').value,
        dia_final: document.getElementById('selectDiaFinal').value,
        hora_inicial: document.getElementById('inputHoraInicial').value,
        hora_final: document.getElementById('inputHoraFinal').value
    };

    if (!horarioGeneral.hora_inicial || !horarioGeneral.hora_final) {
        mostrarAdvertencia('Horario incompleto', 'Define la hora de apertura y cierre del parqueadero.');
        btn.disabled = false;
        return;
    }

    const servicios = Array.from(document.querySelectorAll('.item-servicio'))
        .filter(item => item.querySelector('.chk-servicio').checked)
        .map(function (item) {
            const idServicio = parseInt(item.querySelector('.chk-servicio').dataset.idServicio);
            const tieneHorarioPropio = item.querySelector('.chk-horario-propio').checked;

            return {
                id_tipo_servicio: idServicio,
                horario_propio: tieneHorarioPropio ? {
                    dia_inicial: item.querySelector('.select-dia-inicial-propio').value,
                    dia_final: item.querySelector('.select-dia-final-propio').value,
                    hora_inicial: item.querySelector('.input-hora-inicial-propio').value,
                    hora_final: item.querySelector('.input-hora-final-propio').value
                } : null
            };
        });

    try {
        const resHorario = await fetch('/api/parqueadero/horario-general', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(horarioGeneral)
        });
        const datosHorario = await resHorario.json();

        if (!resHorario.ok) {
            mostrarError('Error', datosHorario.error || 'No se pudo guardar el horario general.');
            return;
        }

        const resServicios = await fetch('/api/parqueadero/servicios', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ servicios })
        });
        const datosServicios = await resServicios.json();

        if (!resServicios.ok) {
            mostrarError('Error', datosServicios.error || 'No se pudieron guardar los servicios.');
            return;
        }

        mostrarExito('Guardado correctamente', 'El horario y los servicios fueron actualizados.');

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
        btn.disabled = false;
    }
}


// ── Tab: Fotos ───────────────────────────────────────────────────────────────

function poblarGaleriaFotos() {
    const contenedor = document.getElementById('galeriaFotos');
    contenedor.innerHTML = '';

    perfilActual.fotos.forEach(function (foto) {
        const item = document.createElement('div');
        item.className = 'foto-item';
        item.innerHTML = `
            <img src="/static/${foto.ruta_archivo}" alt="Foto del parqueadero">
            <button type="button" class="btn-eliminar-foto" data-id-imagen="${foto.id_imagen}">
                <span class="material-symbols-outlined" style="font-size: 1rem;">close</span>
            </button>
        `;
        contenedor.appendChild(item);
    });

    document.querySelectorAll('.btn-eliminar-foto').forEach(function (btn) {
        btn.addEventListener('click', function () {
            eliminarFoto(parseInt(btn.dataset.idImagen));
        });
    });

    document.getElementById('cargaFotoBox').classList.toggle('oculto', perfilActual.fotos.length >= 6);
}

async function subirFoto() {
    const input = document.getElementById('inputFoto');
    const archivo = input.files[0];
    if (!archivo) return;

    const formData = new FormData();
    formData.append('imagen', archivo);

    try {
        const res = await fetch('/api/parqueadero/fotos', {
            method: 'POST',
            credentials: 'same-origin',
            body: formData
        });
        const datos = await res.json();

        if (!res.ok) {
            mostrarError('Error', datos.error || 'No se pudo subir la imagen.');
            return;
        }

        perfilActual.fotos.push({
            id_imagen: datos.id_imagen,
            ruta_archivo: datos.ruta_archivo,
            orden: datos.orden
        });
        poblarGaleriaFotos();

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
        input.value = '';
    }
}

async function eliminarFoto(idImagen) {
    try {
        const res = await fetch(`/api/parqueadero/fotos/${idImagen}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        const datos = await res.json();

        if (!res.ok) {
            mostrarError('Error', datos.error || 'No se pudo eliminar la imagen.');
            return;
        }

        perfilActual.fotos = perfilActual.fotos.filter(f => f.id_imagen !== idImagen);
        poblarGaleriaFotos();

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    }
}


// ── Utilidades SweetAlert2 ────────────────────────────────────────────────────

function mostrarExito(titulo, texto) {
    Swal.fire({
        title: titulo,
        text: texto,
        icon: 'success',
        background: '#001f2e',
        color: '#cfe9ff',
        iconColor: '#91f78e',
        confirmButtonColor: '#91f78e',
        confirmButtonText: 'Listo',
        didOpen: () => {
            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #91f78e';
                popup.style.borderRadius = '12px';
            }
            estilizarBotonSwal();
        }
    });
}

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