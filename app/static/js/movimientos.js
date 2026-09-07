/**
 * movimientos.js — RF_14 / RF_15
 * Controla la tabla de historial de movimientos del parqueadero del
 * administrador: carga los registros desde la API, los renderiza en
 * la tabla y filtra por placa o código de referencia en tiempo real.
 *
 * El toggle del sidebar, el avatar y el cierre de sesión los maneja
 * dashboard.js; este archivo solo gestiona el contenido de esta vista.
 */

// Almacena en memoria los movimientos ya cargados para poder filtrarlos
// sin volver a consultar la API en cada tecla del buscador.
let movimientosCache = [];

document.addEventListener('DOMContentLoaded', function () {
    cargarMovimientos();

    const buscador = document.getElementById('buscadorTabla');
    if (buscador) {
        buscador.addEventListener('input', function () {
            filtrarMovimientos(buscador.value.trim().toLowerCase());
        });
    }
});


// ── Carga de datos ───────────────────────────────────────────────────────────

/**
 * Solicita el historial de movimientos del parqueadero del administrador
 * logueado y dispara el renderizado inicial de la tabla.
 */
async function cargarMovimientos() {
    mostrarLoader(true);

    try {
        const res = await fetch('/api/movimientos', {
            method: 'GET',
            credentials: 'same-origin'
        });

        if (!res.ok) {
            throw new Error('Respuesta no exitosa del servidor');
        }

        const datos = await res.json();
        movimientosCache = datos;
        renderizarTabla(movimientosCache);

    } catch (_) {
        mostrarErrorCarga();
    } finally {
        mostrarLoader(false);
    }
}


// ── Renderizado de tabla ─────────────────────────────────────────────────────

/**
 * Construye las filas de la tabla a partir de una lista de movimientos.
 * Muestra el estado vacío correspondiente si la lista está vacía.
 * @param {Array} movimientos - Lista de movimientos a renderizar
 */
function renderizarTabla(movimientos) {
    const cuerpoTabla = document.getElementById('cuerpoTabla');
    const contenedor = document.getElementById('tablaContenedor');
    const noResultados = document.getElementById('noResultados');

    cuerpoTabla.innerHTML = '';
    contenedor.classList.remove('d-none');

    if (movimientos.length === 0) {
        noResultados.classList.remove('d-none');
        return;
    }

    noResultados.classList.add('d-none');

    movimientos.forEach(function (mov) {
        cuerpoTabla.insertAdjacentHTML('beforeend', construirFila(mov));
    });
}

/**
 * Genera el HTML de una fila de la tabla para un movimiento individual,
 * incluyendo los badges de estado (en_parqueadero / retirado) y origen
 * (app / manual).
 * @param {Object} mov - Objeto movimiento devuelto por la API
 * @returns {string} HTML de la fila <tr>
 */
function construirFila(mov) {
    const esActivo = mov.estado === 'en_parqueadero';

    const badgeEstado = esActivo
        ? '<span class="badge-status bg-activo">En parqueadero</span>'
        : '<span class="badge-status bg-retirado">Retirado</span>';

    const badgeOrigen = mov.origen === 'app'
        ? '<span class="badge-origen origen-app">App</span>'
        : '<span class="badge-origen origen-manual">Manual</span>';

    const salida = mov.fecha_hora_salida
        ? formatearFecha(mov.fecha_hora_salida)
        : '—';

    return `
        <tr>
            <td>${mov.codigo_referencia}</td>
            <td>${mov.placa ?? 'N/A'}</td>
            <td>${mov.tipo_vehiculo}</td>
            <td>${mov.conductor}</td>
            <td>${badgeOrigen}</td>
            <td>${formatearFecha(mov.fecha_hora_entrada)}</td>
            <td>${salida}</td>
            <td>${badgeEstado}</td>
        </tr>
    `;
}

/**
 * Formatea una fecha ISO recibida del backend a un formato legible
 * corto (dd/mm/aaaa hh:mm) para la tabla.
 * @param {string} fechaIso - Fecha en formato ISO devuelta por MySQL/Flask
 * @returns {string} Fecha formateada
 */
function formatearFecha(fechaIso) {
    const fecha = new Date(fechaIso);
    return fecha.toLocaleString('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}


// ── Buscador ──────────────────────────────────────────────────────────────────

/**
 * Filtra el arreglo en memoria de movimientos por placa o código de
 * referencia y vuelve a renderizar la tabla con el resultado.
 * @param {string} termino - Texto de búsqueda en minúsculas
 */
function filtrarMovimientos(termino) {
    if (!termino) {
        renderizarTabla(movimientosCache);
        return;
    }

    const filtrados = movimientosCache.filter(function (mov) {
        const placa = (mov.placa ?? '').toLowerCase();
        const codigo = mov.codigo_referencia.toLowerCase();
        return placa.includes(termino) || codigo.includes(termino);
    });

    renderizarTabla(filtrados);
}


// ── Estados de carga y error ──────────────────────────────────────────────────

/**
 * Muestra u oculta el loader inicial de la tabla.
 * @param {boolean} mostrar
 */
function mostrarLoader(mostrar) {
    document.getElementById('loader').classList.toggle('d-none', !mostrar);
}

/**
 * Muestra un aviso de error mediante SweetAlert2 cuando falla la carga
 * del historial de movimientos.
 */
function mostrarErrorCarga() {
    Swal.fire({
        title: 'Error al cargar',
        text: 'No se pudo obtener el historial de movimientos. Intenta de nuevo.',
        icon: 'error',
        background: '#001f2e',
        color: '#cfe9ff',
        iconColor: '#ff5252',
        confirmButtonColor: '#91f78e',
        confirmButtonText: 'Entendido'
    });
}