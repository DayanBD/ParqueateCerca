// ──────────────────────────────────────────────────────────────────────────────
// auth.js — Lógica JavaScript para todas las páginas de autenticación
// Maneja: login, registro, recuperación de contraseña y código OTP
// ──────────────────────────────────────────────────────────────────────────────


// ── Selector de perfil (login.html) ───────────────────────────────────────────
const select = document.getElementById('profileSelect');
if (select) {
    const selected = document.getElementById('profileSelected');
    const profileText = document.getElementById('profileText');
    const options = document.querySelectorAll('.custom-select__option');
    const hidden = document.getElementById('profileType');

    selected.addEventListener('click', () => select.classList.toggle('open'));

    options.forEach(option => {
        option.addEventListener('click', () => {
            options.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            profileText.textContent = option.textContent.trim();
            profileText.style.color = 'var(--clr-on-surface)';
            hidden.value = option.dataset.value;
            select.classList.remove('open');
        });
    });
}


// ── Selector de tipo de documento (registro.html) ─────────────────────────────
const docSelect = document.getElementById('docSelect');
if (docSelect) {
    const docSelected = document.getElementById('docSelected');
    const docText = document.getElementById('docText');
    const docOptions = document.querySelectorAll('#docOptions .custom-select__option');
    const docHidden = document.getElementById('tipoDocumento');

    docSelected.addEventListener('click', () => docSelect.classList.toggle('open'));

    docOptions.forEach(option => {
        option.addEventListener('click', () => {
            docOptions.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            docText.textContent = option.textContent.trim();
            docText.style.color = 'var(--clr-on-surface)';
            docHidden.value = option.dataset.value;
            docSelect.classList.remove('open');
        });
    });
}


// ── Inputs de código OTP (codigo.html) ────────────────────────────────────────
const codeInputs = document.querySelectorAll('.code-input');
if (codeInputs.length > 0) {
    codeInputs.forEach((input, index) => {

        input.addEventListener('keypress', function (e) {
            if (!/[0-9]/.test(e.key)) e.preventDefault();
        });

        input.addEventListener('input', function () {
            if (this.value.length === 1 && index < codeInputs.length - 1) {
                codeInputs[index + 1].focus();
            }
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && this.value === '' && index > 0) {
                codeInputs[index - 1].focus();
            }
        });
    });
}


// ── Mostrar/ocultar contraseña ─────────────────────────────────────────────────
const toggleBtns = document.querySelectorAll('.toggle-password');
if (toggleBtns.length > 0) {
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            const input = this.previousElementSibling;
            const icon = this.querySelector('.material-symbols-outlined');
            if (input.type === 'password') {
                input.type = 'text';
                icon.textContent = 'visibility_off';
            } else {
                input.type = 'password';
                icon.textContent = 'visibility';
            }
        });
    });
}

// ── Validación de formato de contraseña ────────────────────────────────────────
/**
 * Valida el mismo requisito que el backend: mínimo 8 caracteres, una
 * mayúscula y un carácter especial. Se usa antes de enviar cualquier
 * formulario que cree o cambie una contraseña, para dar feedback
 * inmediato sin esperar la respuesta del servidor.
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


// ── Login ──────────────────────────────────────────────────────────────────────
const loginForm = document.querySelector('form');
if (loginForm && document.getElementById('email') && document.getElementById('password')) {
    loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const correo = document.getElementById('email').value;
        const contrasena = document.getElementById('password').value;
        const perfil = document.getElementById('profileType').value;

        if (!perfil) {
            mostrarAdvertencia('Campo obligatorio', 'Por favor selecciona un tipo de perfil.');
            return;
        }

        const respuesta = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo, contrasena, perfil })
        });

        const datos = await respuesta.json();

        if (respuesta.ok) {
            if (datos.perfil === 'Conductor') {
                window.location.href = '/conductor/mapa';
            } else {
                window.location.href = '/administrador/movimientos';
            }
        } else {
            mostrarError('No se pudo iniciar sesión', datos.error);
        }
    });
}


// ── Registro ───────────────────────────────────────────────────────────────────
const formRegistro = document.getElementById('formRegistro');
if (formRegistro) {
    formRegistro.addEventListener('submit', async function (e) {
        e.preventDefault();

        const tipoDocumento = document.getElementById('tipoDocumento').value;
        const numeroDocumento = document.getElementById('numeroDocumento').value;
        const nombres = document.getElementById('nombres').value;
        const apellidos = document.getElementById('apellidos').value;
        const telefono = document.getElementById('telefono').value;
        const correo = document.getElementById('correo').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const terms = document.getElementById('terms').checked;

        if (!tipoDocumento) {
            mostrarAdvertencia('Campo obligatorio', 'Por favor selecciona un tipo de documento.');
            return;
        }

        if (password !== confirmPassword) {
            mostrarAdvertencia('Las contraseñas no coinciden', 'Verifica que ambos campos sean idénticos.');
            return;
        }

        const errorContrasena = validarContrasena(password);
        if (errorContrasena) {
            mostrarAdvertencia('Contraseña no válida', errorContrasena);
            return;
        }

        if (!terms) {
            mostrarAdvertencia('Términos y condiciones', 'Debes aceptar los términos y condiciones para continuar.');
            return;
        }

        const respuesta = await fetch('/api/registro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_tipo_documento: tipoDocumento,
                numero_documento: numeroDocumento,
                nombres,
                apellidos,
                telefono,
                correo,
                contrasena: password
            })
        });

        const datos = await respuesta.json();

        if (respuesta.ok) {
            window.location.href = '/conductor/mapa';
        } else {
            mostrarError('No se pudo crear la cuenta', datos.error);
        }
    });
}


// ── Recuperar contraseña ───────────────────────────────────────────────────────
const formRecuperar = document.getElementById('formRecuperar');
if (formRecuperar) {
    formRecuperar.addEventListener('submit', async function (e) {
        e.preventDefault();

        const correo = document.getElementById('email').value;

        const respuesta = await fetch('/api/recuperar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo })
        });

        const datos = await respuesta.json();

        if (respuesta.ok) {
            window.location.href = '/codigo';
        } else {
            mostrarError('No se pudo enviar el código', datos.error);
        }
    });
}


// ── Verificar código OTP ────────────────────────────────────────────────────────
const formCodigo = document.getElementById('form-codigo');
if (formCodigo) {
    formCodigo.addEventListener('submit', async function (e) {
        e.preventDefault();

        const inputs = document.querySelectorAll('.code-input');
        const codigo = Array.from(inputs).map(i => i.value).join('');

        if (codigo.length < 6) {
            mostrarAdvertencia('Código incompleto', 'Ingresa los 6 dígitos del código.');
            return;
        }

        const respuesta = await fetch('/api/verificar-codigo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo })
        });

        const datos = await respuesta.json();

        if (respuesta.ok) {
            window.location.href = '/nueva-contrasena';
        } else {
            mostrarError('Código incorrecto', datos.error);
        }
    });
}


// ── Nueva contraseña ─────────────────────────────────────────────────────────────
const formNuevaContrasena = document.getElementById('form-recuperar');
if (formNuevaContrasena) {
    formNuevaContrasena.addEventListener('submit', async function (e) {
        e.preventDefault();

        const contrasena = document.getElementById('new_password').value;
        const confirmar = document.getElementById('confirm_password').value;

        if (contrasena !== confirmar) {
            mostrarAdvertencia('Las contraseñas no coinciden', 'Verifica que ambos campos sean idénticos.');
            return;
        }

        const errorContrasena = validarContrasena(contrasena);
        if (errorContrasena) {
            mostrarAdvertencia('Contraseña no válida', errorContrasena);
            return;
        }

        const respuesta = await fetch('/api/nueva-contrasena', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contrasena, confirmar })
        });

        const datos = await respuesta.json();

        if (respuesta.ok) {
            await mostrarExito('Contraseña actualizada', 'Tu contraseña fue cambiada correctamente. Ya puedes iniciar sesión.');
            window.location.href = '/login';
        } else {
            mostrarError('No se pudo cambiar la contraseña', datos.error);
        }
    });
}


// ── Utilidades SweetAlert2 ────────────────────────────────────────────────────

function mostrarExito(titulo, texto) {
    return Swal.fire({
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
    return Swal.fire({
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
    return Swal.fire({
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