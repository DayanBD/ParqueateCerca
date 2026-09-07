/**
 * control_acceso.js — RF_13 / RF_14 / RF_15
 * Controla el flujo de ingresos y salidas del parqueadero:
 *   1. El administrador escribe una placa o un código de referencia.
 *   2. El backend determina si corresponde a un ingreso nuevo
 *      (vehículo de un conductor de la app o registro manual) o a
 *      una salida (vehículo ya presente en el parqueadero).
 *   3. Se confirma la acción y se genera/entrega el código de ticket.
 *      Si el vehículo es de un conductor de la app, ese código se
 *      envía además por SMS (pendiente de proveedor, ver TODO abajo).
 *
 * Caso especial: si el conductor no tiene el código de ticket, el
 * administrador puede buscar la salida directamente por placa
 * mediante un SweetAlert2 independiente del input principal.
 *
 * El toggle del sidebar, el avatar y el logout los maneja dashboard.js.
 */

// Guarda el resultado de la última búsqueda mientras el administrador
// confirma la acción, para no tener que volver a consultar la API.
let contextoActual = null;

document.addEventListener('DOMContentLoaded', function () {

    contextoActual = null;

    const input = document.getElementById('inputBusqueda');
    input.value = '';
    input.disabled = false;

    const btnBuscar = document.getElementById('btnBuscar');
    const btnLimpiar = document.getElementById('btnLimpiar');
    const btnSalidaPorPlaca = document.getElementById('btnSalidaPorPlaca');

    if (btnBuscar) btnBuscar.addEventListener('click', procesarBusqueda);
    if (btnLimpiar) btnLimpiar.addEventListener('click', limpiarFormulario);
    if (btnSalidaPorPlaca) {
        btnSalidaPorPlaca.addEventListener('click', function (e) {
            e.preventDefault();
            abrirModalSalidaPorPlaca();
        });
    }

    // Filtra en vivo: solo letras y números, mayúsculas, máximo 6
    // caracteres. Sin esto el input aceptaba cualquier carácter especial
    // (*, {, [, +, etc.) porque maxlength solo limita la cantidad, no
    // el tipo de carácter permitido.
    if (input) {
        input.addEventListener('input', function () {
            input.value = input.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 6);
        });
    }

    // Permite procesar con la tecla Enter, no solo con el botón
    if (input) {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                procesarBusqueda();
            }
        });
    }

    document.getElementById('btnConfirmarIngresoApp')
        ?.addEventListener('click', confirmarIngresoApp);
    document.getElementById('btnConfirmarIngresoManual')
        ?.addEventListener('click', confirmarIngresoManual);
    document.getElementById('btnConfirmarSalida')
        ?.addEventListener('click', confirmarSalida);
    document.getElementById('btnVolverInicio')
        ?.addEventListener('click', limpiarFormulario);
});


// ── Búsqueda principal (placa o código) ──────────────────────────────────────

/**
 * Envía el valor del input principal al backend, que determina si
 * corresponde a un ingreso (app o manual) o a una salida, y muestra
 * la vista dinámica correspondiente.
 */
async function procesarBusqueda() {
    const input = document.getElementById('inputBusqueda');
    const valor = input.value.trim().toUpperCase();

    if (!valor) {
        mostrarAdvertencia('Campo vacío', 'Ingresa una placa o un código de referencia.');
        return;
    }

    const btnBuscar = document.getElementById('btnBuscar');
    btnBuscar.disabled = true;

    try {
        const res = await fetch(`/api/control-acceso/buscar?valor=${encodeURIComponent(valor)}`, {
            method: 'GET',
            credentials: 'same-origin'
        });
        const datos = await res.json();

        if (!res.ok) {
            mostrarError('Error', datos.error || 'No se pudo procesar la búsqueda.');
            return;
        }

        contextoActual = datos;
        renderizarSegunTipo(datos);

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
        btnBuscar.disabled = false;
    }
}

/**
 * Muestra la vista dinámica correcta según el tipo de resultado
 * devuelto por el backend, y llena los campos de solo lectura.
 * @param {Object} datos - Respuesta de /api/control-acceso/buscar
 */
function renderizarSegunTipo(datos) {
    switch (datos.tipo) {

        case 'ingreso_app':
            document.getElementById('appNombreUsuario').textContent = datos.nombre_conductor;
            document.getElementById('appPlaca').value = datos.placa;
            document.getElementById('appTipoVehiculo').value = datos.tipo_vehiculo;
            document.getElementById('appTelefono').value = datos.telefono || '';
            document.getElementById('appCorreo').value = datos.correo || '';
            mostrarVista('viewIngresoApp');
            break;

        case 'ingreso_manual':
            document.getElementById('manualPlaca').value = datos.placa;
            mostrarVista('viewIngresoManual');
            break;

        case 'salida':
            pintarVistaSalida(datos);
            mostrarVista('viewSalida');
            break;

        case 'codigo_usado':
            mostrarAdvertencia(
                'Código ya utilizado',
                'Ese código de referencia ya fue usado y el vehículo correspondiente ya salió. Verifica el ticket o usa la placa del vehículo.'
            );
            break;

        case 'ya_parqueado':
            mostrarAdvertencia(
                'Vehículo ya está adentro',
                'Este vehículo ya tiene un ingreso activo. Usa "¿No tiene el código? Procesar salida por placa" para darle salida.'
            );
            break;

        case 'no_encontrado':
            mostrarAdvertencia(
                'Sin resultados',
                'No se encontró ningún vehículo o ticket con ese valor. Verifica y vuelve a intentar.'
            );
            break;

        default:
            mostrarError('Respuesta inesperada', 'El servidor devolvió un resultado no reconocido.');
    }
}


// ── Confirmaciones de cada flujo ─────────────────────────────────────────────

/**
 * Confirma el ingreso de un vehículo vinculado a un conductor de la app.
 * Registra el movimiento, genera el código de ticket y dispara el envío
 * por SMS (pendiente de proveedor).
 */
async function confirmarIngresoApp() {
    await registrarIngreso({
        origen: 'app',
        placa: contextoActual.placa,
        id_usuario: contextoActual.id_usuario,
        id_tipo_vehiculo: contextoActual.id_tipo_vehiculo
    });
}

/**
 * Confirma el ingreso de un vehículo no vinculado a ningún conductor
 * de la app (registro manual). Nombre, teléfono y correo son
 * obligatorios: el teléfono es indispensable porque el código de
 * salida se envía por SMS a ese número, igual que en el flujo de la app.
 */
async function confirmarIngresoManual() {
    const idTipoVehiculo = document.getElementById('manualSelectTipo').value;
    const propietario = document.getElementById('manualPropietario').value.trim();
    const telefono = document.getElementById('manualTelefono').value.trim();
    const correo = document.getElementById('manualCorreo').value.trim();

    if (!propietario) {
        mostrarAdvertencia('Campo obligatorio', 'Debes ingresar el nombre del propietario.');
        return;
    }

    if (!/^\d{10}$/.test(telefono)) {
        mostrarAdvertencia('Teléfono inválido', 'El teléfono debe tener exactamente 10 dígitos numéricos.');
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        mostrarAdvertencia('Correo inválido', 'Ingresa un correo electrónico válido.');
        return;
    }

    await registrarIngreso({
        origen: 'manual',
        placa: contextoActual.placa,
        id_usuario: null,
        id_tipo_vehiculo: idTipoVehiculo,
        propietario_manual: propietario,
        telefono_manual: telefono,
        correo_manual: correo
    });
}

/**
 * Envía el registro de ingreso al backend (RF_14) y, si es exitoso,
 * muestra la vista de código generado. El backend es quien decide y
 * ejecuta el envío por SMS si corresponde (origen = 'app'); aquí solo
 * se ajusta el texto de instrucción en pantalla según el caso.
 * @param {Object} payload - Datos del ingreso a registrar
 */
async function registrarIngreso(payload) {
    try {
        const res = await fetch('/api/control-acceso/ingreso', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const datos = await res.json();

        if (!res.ok) {
            mostrarError('Error', datos.error || 'No se pudo registrar el ingreso.');
            return;
        }

        document.getElementById('txtCodigoGenerado').textContent = datos.codigo_referencia;

        document.getElementById('txtInstruccionCodigo').textContent =
            payload.origen === 'app'
                ? 'Este código también fue enviado por SMS y correo al conductor.'
                : 'Este código también fue enviado al correo del conductor. Entrégaselo para su salida:';

        mostrarVista('viewExitoCodigo');

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    }
}

/**
 * Confirma la salida de un vehículo y libera el cupo correspondiente
 * (RF_15). Aplica tanto para el flujo normal (código/placa en el
 * input principal) como para el flujo especial de salida por placa.
 */
async function confirmarSalida() {
    const btn = document.getElementById('btnConfirmarSalida');
    btn.disabled = true;

    try {
        const res = await fetch('/api/control-acceso/salida', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ id_movimiento: contextoActual.id_movimiento })
        });
        const datos = await res.json();

        if (!res.ok) {
            mostrarError('Error', datos.error || 'No se pudo registrar la salida.');
            return;
        }

        await Swal.fire({
            title: 'Salida registrada',
            text: 'El cupo fue liberado correctamente.',
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

        limpiarFormulario();

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
        btn.disabled = false;
    }
}


// ── Caso especial: salida por placa sin código ───────────────────────────────

/**
 * Abre un SweetAlert2 con un input de placa, independiente del campo
 * de búsqueda principal, para el caso en que el conductor no tenga
 * el código de ticket. Si encuentra un movimiento activo con esa
 * placa, salta directo a la vista de salida.
 */
async function abrirModalSalidaPorPlaca() {
    const { value: placa } = await Swal.fire({
        title: 'Salida por placa',
        input: 'text',
        inputLabel: 'Placa del vehículo',
        inputPlaceholder: 'Ej: ABC123',
        background: '#001f2e',
        color: '#cfe9ff',
        confirmButtonColor: '#91f78e',
        confirmButtonText: 'Buscar',
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        cancelButtonColor: '#ff5252',
        inputValidator: (valor) => {
            if (!valor || !valor.trim()) {
                return 'Debes ingresar una placa';
            }
        },
        didOpen: () => {
            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #91f78e';
                popup.style.borderRadius = '12px';
            }
            estilizarBotonSwal();

            const cancelBtn = Swal.getCancelButton();
            if (cancelBtn) {
                cancelBtn.style.borderRadius = '8px';
                cancelBtn.style.fontWeight = '700';
            }
        }
    });

    if (!placa) return;

    await buscarSalidaPorPlaca(placa.trim().toUpperCase());
}

/**
 * Consulta el backend por un movimiento activo (estado = en_parqueadero)
 * para la placa indicada, dentro del parqueadero del administrador.
 * @param {string} placa - Placa a buscar
 */
async function buscarSalidaPorPlaca(placa) {
    try {
        const res = await fetch(`/api/control-acceso/salida/buscar-por-placa?placa=${encodeURIComponent(placa)}`, {
            method: 'GET',
            credentials: 'same-origin'
        });
        const datos = await res.json();

        if (!res.ok) {
            mostrarAdvertencia(
                'Sin resultados',
                datos.error || 'No se encontró un vehículo activo con esa placa en tu parqueadero.'
            );
            return;
        }

        contextoActual = datos;
        pintarVistaSalida(datos);
        mostrarVista('viewSalida');

    } catch (_) {
        mostrarError('Error de conexión', 'No se pudo conectar con el servidor. Intenta de nuevo.');
    }
}


// ── Utilidades de vista ──────────────────────────────────────────────────────

/**
 * Llena los campos de la vista de salida con los datos del movimiento
 * y calcula el tiempo transcurrido desde el ingreso.
 * @param {Object} datos - Datos del movimiento activo
 */
function pintarVistaSalida(datos) {
    document.getElementById('salidaTipoCliente').textContent =
        datos.origen === 'app' ? 'Vehículo vinculado a la app' : 'Registro manual';
    document.getElementById('salidaPlaca').textContent = datos.placa;

    const fechaIngreso = new Date(datos.fecha_hora_entrada);
    document.getElementById('salidaHoraIngreso').textContent =
        fechaIngreso.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    document.getElementById('salidaTiempo').textContent = calcularTiempoTranscurrido(fechaIngreso);
}

/**
 * Calcula el tiempo transcurrido entre la fecha de ingreso y ahora,
 * en formato "Xh Ym".
 * @param {Date} fechaIngreso
 * @returns {string}
 */
function calcularTiempoTranscurrido(fechaIngreso) {
    const minutosTotales = Math.max(0, Math.floor((new Date() - fechaIngreso) / 60000));
    const horas = Math.floor(minutosTotales / 60);
    const minutos = minutosTotales % 60;
    return `${horas}h ${minutos}m`;
}

/**
 * Oculta todas las vistas dinámicas y muestra únicamente la solicitada.
 * También bloquea el input principal y muestra el botón de limpiar,
 * para evitar que el administrador edite la búsqueda a mitad de flujo.
 * @param {string} idVista - ID del contenedor a mostrar
 */
function mostrarVista(idVista) {
    const vistas = ['viewIngresoApp', 'viewIngresoManual', 'viewSalida', 'viewExitoCodigo'];
    vistas.forEach(function (id) {
        document.getElementById(id).classList.toggle('d-none', id !== idVista);
    });

    document.getElementById('inputBusqueda').disabled = true;
    document.getElementById('btnBuscar').disabled = true;
    document.getElementById('btnLimpiar').classList.remove('d-none');
}

/**
 * Restablece el módulo a su estado inicial: limpia el input, oculta
 * todas las vistas dinámicas y libera el contexto de la búsqueda
 * anterior. Se usa tanto al presionar "Limpiar" como después de
 * completar un ingreso o una salida.
 */
function limpiarFormulario() {
    contextoActual = null;

    const input = document.getElementById('inputBusqueda');
    input.value = '';
    input.disabled = false;

    document.getElementById('btnBuscar').disabled = false;
    document.getElementById('manualPropietario').value = '';
    document.getElementById('manualTelefono').value = '';
    document.getElementById('manualCorreo').value = '';
    document.getElementById('btnLimpiar').classList.add('d-none');

    ['viewIngresoApp', 'viewIngresoManual', 'viewSalida', 'viewExitoCodigo'].forEach(function (id) {
        document.getElementById(id).classList.add('d-none');
    });

    input.focus();
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