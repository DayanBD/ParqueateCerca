/**
 * dashboard.js — Panel de control del conductor — Parquéate Cerca
 * Responsabilidades:
 *   - Toggle del sidebar
 *   - Carga y población del perfil desde la API
 *   - Construcción del avatar con DiceBear Initials
 *   - Envío de actualizaciones del formulario
 *   - Logout
 *   - Cancelar edición (restaurar valores originales)
 */

// Estado original del formulario para la acción "Cancelar"
let _datosOriginales = {};

// id del parqueadero del usuario, si ya tiene uno registrado (null si no).
// Controla el ícono y el destino del botón "Registrar mi parqueadero".
let _idParqueaderoDelUsuario = null;

document.addEventListener('DOMContentLoaded', function () {

    // ── Toggle del sidebar ───────────────────────────────────────────────────
    const btnToggle = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');

    if (btnToggle && sidebar) {
        btnToggle.addEventListener('click', function () {
            sidebar.classList.toggle('expanded');
            if (mainContent) {
                mainContent.classList.toggle('sidebar-expanded');
            }
        });
    }

    // ── Carga inicial del perfil ─────────────────────────────────────────────
    cargarPerfil();

    // ── Evento submit del formulario ─────────────────────────────────────────
    const formPerfil = document.getElementById('formPerfil');
    if (formPerfil) {
        formPerfil.addEventListener('submit', function (e) {
            e.preventDefault();
            guardarCambios();
        });
    }

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
            // rol_administrador_requerido y exige ese perfil en sesión. Sin
            // este paso, el decorador rebotaría de vuelta al mapa sin avisar.
            try {
                const res = await fetch('/api/usuario/cambiar-perfil', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ perfil: 2 })
                });

                if (!res.ok) {
                    mostrarAlerta('No se pudo cambiar a tu perfil de Administrador. Intenta de nuevo.', 'danger');
                    return;
                }

                window.location.href = '/administrador/movimientos';

            } catch (err) {
                mostrarAlerta('Error de conexión al cambiar de perfil.', 'danger');
            }
        });
    }

    // ── Botón Volver a modo conductor (solo aparece en páginas de admin) ────
    const btnVolverConductor = document.getElementById('btnVolverConductor');
    if (btnVolverConductor) {
        btnVolverConductor.addEventListener('click', async function (e) {
            e.preventDefault();

            // No requiere validación previa: a diferencia de pasar a
            // Administrador, volver a Conductor no exige tener nada
            // registrado (ver api_cambiar_perfil).
            try {
                const res = await fetch('/api/usuario/cambiar-perfil', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ perfil: 1 })
                });

                if (!res.ok) {
                    mostrarAlerta('No se pudo cambiar a tu perfil de Conductor. Intenta de nuevo.', 'danger');
                    return;
                }

                window.location.href = '/conductor/mapa';

            } catch (err) {
                mostrarAlerta('Error de conexión al cambiar de perfil.', 'danger');
            }
        });
    }

    // ── Botón Cancelar ───────────────────────────────────────────────────────
    const btnCancelar = document.getElementById('btnCancelar');
    if (btnCancelar) {
        btnCancelar.addEventListener('click', restaurarDatos);
    }

    // ── Botón Logout con confirmación SweetAlert2 ─────────────────────────────
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
                customClass: {
                    closeButton: 'swal-close-custom'
                },
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
                if (result.isConfirmed) {
                    cerrarSesion();
                }
            });
        });
    }

    // ── Botón Cambiar contraseña — abre el modal ──────────────────────────────
    const btnCambiarContrasena = document.getElementById('btnCambiarContrasena');
    if (btnCambiarContrasena) {
        btnCambiarContrasena.addEventListener('click', function (e) {
            e.preventDefault();
            document.getElementById('formContrasena').reset();
            const modal = new bootstrap.Modal(document.getElementById('modalContrasena'));
            modal.show();
        });
    }

    // ── Botón Guardar contraseña — envía el formulario del modal ──────────────
    const btnGuardarContrasena = document.getElementById('btnGuardarContrasena');
    if (btnGuardarContrasena) {
        btnGuardarContrasena.addEventListener('click', cambiarContrasena);
    }

    // Abre el modal automáticamente si viene con el parámetro desde otra página
    const params = new URLSearchParams(window.location.search);
    if (params.get('accion') === 'cambiar-contrasena') {
        document.getElementById('formContrasena').reset();
        const modal = new bootstrap.Modal(document.getElementById('modalContrasena'));
        modal.show();
    }

});

// ── Toggle visibilidad de contraseñas en el modal (delegación global) ─────
document.addEventListener('click', function (e) {
    const btn = e.target.closest('.toggle-password-modal');
    if (!btn) return;

    const input = btn.parentElement.querySelector('input');
    const icon = btn.querySelector('.material-symbols-outlined');
    if (!input || !icon) return;

    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = 'visibility_off';
    } else {
        input.type = 'password';
        icon.textContent = 'visibility';
    }
});


/**
 * Ajusta el botón "Registrar mi parqueadero" de la navbar según si el
 * conductor ya tiene un parqueadero registrado. Si ya lo tiene, el
 * botón cambia de ícono y pasa a llevar directo a la operación diaria
 * del negocio (Movimientos), en vez de repetir el flujo de registro.
 * @param {number|null} idParqueadero
 */
function configurarBotonParqueadero(idParqueadero) {
    _idParqueaderoDelUsuario = idParqueadero;

    const btn = document.getElementById('btnRegistrarParqueadero');
    if (!btn) return;

    const icono = btn.querySelector('.material-symbols-outlined');
    const texto = document.getElementById('txtBotonParqueadero');

    if (idParqueadero) {
        btn.title = 'Ir a mi parqueadero';
        if (icono) icono.textContent = 'storefront';
        if (texto) texto.textContent = 'Mi Parqueadero';
    } else {
        btn.title = 'Registrar mi parqueadero';
        if (icono) icono.textContent = 'add_business';
        if (texto) texto.textContent = 'Registrar parqueadero';
    }
}

/**
 * Llama a GET /api/usuario/perfil y puebla todos los elementos de la vista.
 */
async function cargarPerfil() {
    try {
        const res = await fetch('/api/usuario/perfil', {
            method: 'GET',
            credentials: 'same-origin'
        });

        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }

        if (!res.ok) {
            mostrarAlerta('No se pudo cargar el perfil. Intente de nuevo.', 'danger');
            return;
        }

        const usuario = await res.json();

        // Guarda los datos originales para el botón Cancelar
        _datosOriginales = {
            nombres: usuario.nombres || '',
            apellidos: usuario.apellidos || '',
            correo: usuario.correo || '',
            telefono: usuario.telefono || ''
        };

        // Puebla el formulario
        setVal('inputNombres', usuario.nombres);
        setVal('inputApellidos', usuario.apellidos);
        setVal('inputCorreo', usuario.correo);
        setVal('inputTelefono', usuario.telefono || '');
        setVal('inputTipoDoc', usuario.tipo_documento);
        setVal('inputDoc', usuario.numero_documento);

        // Puebla la tarjeta lateral izquierda
        const nombreCompleto = `${usuario.nombres} ${usuario.apellidos}`;
        setTexto('mainCardName', nombreCompleto);
        setTexto('mainCardCorreo', usuario.correo);
        setTexto('sidebarName', nombreCompleto);

        // Construye y asigna el avatar DiceBear con las iniciales
        const avatarUrl = construirAvatarUrl(nombreCompleto);
        setAvatar('mainAvatar', avatarUrl, nombreCompleto);
        setAvatar('sidebarAvatar', avatarUrl, nombreCompleto);

        // Ajusta el botón de la navbar según si ya tiene parqueadero
        configurarBotonParqueadero(usuario.id_parqueadero);

    } catch (err) {
        mostrarAlerta('Error de conexión al cargar el perfil.', 'danger');
    }
}


/**
 * Construye la URL del avatar DiceBear Initials.
 * No requiere API key. Genera el SVG en tiempo real por URL.
 * @param {string} nombre - Nombre completo del usuario
 * @returns {string} URL del SVG generado
 */
function construirAvatarUrl(nombre) {
    const seed = encodeURIComponent(nombre);
    return `https://api.dicebear.com/9.x/initials/svg?seed=${seed}&backgroundColor=1a3c5e&fontSize=38&fontWeight=600`;
}


/**
 * Recoge los valores del formulario, los valida y los envía
 * a PUT /api/usuario/modificar.
 */
async function guardarCambios() {
    const payload = {
        nombres: getVal('inputNombres').trim(),
        apellidos: getVal('inputApellidos').trim(),
        correo: getVal('inputCorreo').trim(),
        telefono: getVal('inputTelefono').trim()
    };

    // Validación de campos obligatorios
    if (!payload.nombres || !payload.apellidos || !payload.correo || !payload.telefono) {
        mostrarAlerta('Todos los campos son obligatorios.', 'warning');
        return;
    }

    // Validación de formato de teléfono: solo dígitos, entre 7 y 15 caracteres
    if (!/^\d{7,15}$/.test(payload.telefono)) {
        mostrarAlerta('El teléfono debe contener solo números (7 a 15 dígitos).', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/usuario/modificar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
            mostrarAlerta(data.error || 'No se pudieron guardar los cambios.', 'danger');
            return;
        }

        // Actualiza los datos originales con los nuevos valores confirmados
        _datosOriginales = { ...payload };

        // Refresca nombre y avatar en la vista sin recargar la página
        const nombreCompleto = `${payload.nombres} ${payload.apellidos}`;
        setTexto('mainCardName', nombreCompleto);
        setTexto('mainCardCorreo', payload.correo);
        setTexto('sidebarName', nombreCompleto);
        const avatarUrl = construirAvatarUrl(nombreCompleto);
        setAvatar('mainAvatar', avatarUrl, nombreCompleto);
        setAvatar('sidebarAvatar', avatarUrl, nombreCompleto);

        mostrarAlerta('Datos actualizados correctamente.', 'success');

    } catch (err) {
        mostrarAlerta('Error de conexión al guardar los cambios.', 'danger');
    }
}


/**
 * Restaura los campos del formulario al último estado guardado en BD.
 * Se ejecuta al hacer clic en el botón Cancelar.
 */
function restaurarDatos() {
    setVal('inputNombres', _datosOriginales.nombres);
    setVal('inputApellidos', _datosOriginales.apellidos);
    setVal('inputCorreo', _datosOriginales.correo);
    setVal('inputTelefono', _datosOriginales.telefono);
}


/**
 * Llama a POST /api/usuario/logout y redirige al login.
 * El bloque finally garantiza la redirección aunque el fetch falle.
 */
async function cerrarSesion() {
    try {
        await fetch('/api/usuario/logout', {
            method: 'POST',
            credentials: 'same-origin'
        });
    } finally {
        window.location.href = '/login';
    }
}


// ── Utilidades DOM ────────────────────────────────────────────────────────────

/** Obtiene el value de un input por su ID. */
function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

/** Asigna un value a un input por su ID. */
function setVal(id, valor) {
    const el = document.getElementById(id);
    if (el) el.value = valor || '';
}

/** Asigna textContent a un elemento por su ID. */
function setTexto(id, texto) {
    const el = document.getElementById(id);
    if (el) el.textContent = texto || '';
}

/** Asigna src y alt a una etiqueta img por su ID. */
function setAvatar(id, url, alt) {
    const el = document.getElementById(id);
    if (el) {
        el.src = url;
        el.alt = alt || 'Avatar';
    }
}


/**
 * Muestra un alert de Bootstrap 5 encima del formulario.
 * Se elimina automáticamente a los 4 segundos.
 * @param {string} mensaje - Texto del mensaje
 * @param {string} tipo    - 'success' | 'danger' | 'warning'
 */
function mostrarAlerta(mensaje, tipo) {
    // Elimina alertas previas para no acumular
    document.querySelectorAll('.alerta-perfil').forEach(a => a.remove());

    const alerta = document.createElement('div');
    alerta.className = `alert alert-${tipo} alert-dismissible fade show alerta-perfil`;
    alerta.setAttribute('role', 'alert');
    alerta.innerHTML = `
        ${mensaje}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Cerrar"></button>
    `;

    // Inserta la alerta inmediatamente antes del formulario
    const form = document.getElementById('formPerfil');
    if (form) form.parentNode.insertBefore(alerta, form);

    // Auto-eliminación a los 4 segundos
    setTimeout(() => alerta.remove(), 4000);
}

/**
 * Recoge los valores del modal, los valida y los envía
 * a PUT /api/usuario/cambiar-contrasena.
 * Cierra el modal y muestra SweetAlert2 según el resultado.
 */
async function cambiarContrasena() {
    const actual = document.getElementById('inputContrasenaActual').value.trim();
    const nueva = document.getElementById('inputContrasenaNueva').value.trim();
    const confirmar = document.getElementById('inputConfirmarContrasena').value.trim();

    // Configuración base con inyección de estilo en línea para el texto del botón
    const CustomSwal = Swal.mixin({
        background: '#00101b',
        color: '#e0e0e0',
        confirmButtonColor: '#91f78e',
        didOpen: () => {
            const confirmBtn = Swal.getConfirmButton();
            if (confirmBtn) {
                confirmBtn.style.color = '#00101b';
            }

            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #91f78e'
            }
        }
    });

    if (!actual || !nueva || !confirmar) {
        CustomSwal.fire({
            title: 'Campos incompletos',
            text: 'Todos los campos son obligatorios.',
            icon: 'warning'
        });
        return;
    }

    if (nueva !== confirmar) {
        CustomSwal.fire({
            title: 'Las contraseñas no coinciden',
            text: 'La nueva contraseña y su confirmación deben ser iguales.',
            icon: 'error'
        });
        return;
    }

    const errorContrasena = validarContrasena(nueva);
    if (errorContrasena) {
        CustomSwal.fire({
            title: 'Contraseña no válida',
            text: errorContrasena,
            icon: 'error'
        });
        return;
    }

    try {
        const res = await fetch('/api/usuario/cambiar-contrasena', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contrasena_actual: actual,
                contrasena_nueva: nueva,
                confirmar: confirmar
            })
        });

        const data = await res.json();

        const instanciaModal = bootstrap.Modal.getInstance(
            document.getElementById('modalContrasena')
        );
        if (instanciaModal) instanciaModal.hide();

        if (!res.ok) {
            CustomSwal.fire({
                title: 'Error',
                text: data.error || 'No se pudo cambiar la contraseña.',
                icon: 'error'
            });
            return;
        }

        CustomSwal.fire({
            title: 'Contraseña actualizada',
            text: 'Tu contraseña fue cambiada correctamente.',
            icon: 'success'
        });

    } catch (err) {
        CustomSwal.fire({
            title: 'Error de conexión',
            text: 'No se pudo conectar con el servidor.',
            icon: 'error'
        });
    }
}

/**
 * Valida el mismo requisito que el backend: mínimo 8 caracteres, una
 * mayúscula y un carácter especial. Se usa antes de enviar el cambio
 * de contraseña, para dar feedback inmediato sin esperar la
 * respuesta del servidor.
 * @param {string} contrasena
 * @returns {string|null} mensaje de error, o null si es válida
 */
function validarContrasena(contrasena) {
    if (contrasena.length < 8) {
        return 'La contraseña debe tener mínimo 8 caracteres';
    }
    if (!/[A-Z]/.test(contrasena)) {
        return 'La contraseña debe incluir al menos una letra mayúscula';
    }
    if (!/[^A-Za-z0-9]/.test(contrasena)) {
        return 'La contraseña debe incluir al menos un carácter especial';
    }
    return null;
}