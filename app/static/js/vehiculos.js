/**
 * vehiculos.js — Módulo de gestión de vehículos — Parquéate Cerca
 * Responsabilidades:
 *   - Toggle del sidebar y logout (compartidos con perfil)
 *   - Carga del avatar en sidebar desde la API de perfil
 *   - Listado, creación, edición y eliminación de vehículos
 */

// Mapa de íconos por tipo de vehículo
const ICONOS_VEHICULO = {
    'Automóvil': 'directions_car',
    'Motocicleta': 'two_wheeler',
    'Bicicleta': 'pedal_bike',
    'Camión': 'local_shipping',
    'Bus': 'directions_bus'
};

// id del parqueadero del usuario, si ya tiene uno registrado (null si no).
// Controla el ícono y el destino del botón "Registrar mi parqueadero".
let _idParqueaderoDelUsuario = null;

/**
 * Muestra u oculta el campo de placa según el tipo de vehículo.
 * Las bicicletas no tienen placa; se asigna N/A automáticamente.
 * @param {string} tipoTexto - Texto visible de la opción seleccionada
 */
function toggleCampoPlaca(tipoTexto) {
    const campo = document.getElementById('campoPlaca');
    const input = document.getElementById('inputPlaca');
    if (!campo || !input) return;

    if (tipoTexto === 'Bicicleta') {
        campo.style.display = 'none';
        input.value = '';
    } else {
        campo.style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', function () {

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

    // ── Carga inicial ────────────────────────────────────────────────────────
    cargarAvatarSidebar();
    cargarTiposVehiculo();
    cargarVehiculos();

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

    // ── Botón Agregar ────────────────────────────────────────────────────────
    const btnAgregar = document.getElementById('btnAgregarVehiculo');
    if (btnAgregar) {
        btnAgregar.addEventListener('click', abrirModalAgregar);
    }

    // ── Select personalizado de tipo de vehículo ─────────────────────────────
    const tipoVehiculoSelected = document.getElementById('tipoVehiculoSelected');
    if (tipoVehiculoSelected) {
        tipoVehiculoSelected.addEventListener('click', function () {
            document.getElementById('tipoVehiculoSelect').classList.toggle('open');
        });
    }

    // ── Botón Guardar del modal ──────────────────────────────────────────────
    const btnGuardar = document.getElementById('btnGuardarVehiculo');
    if (btnGuardar) {
        btnGuardar.addEventListener('click', guardarVehiculo);
    }

    // ── Botón Cambiar contraseña — redirige al perfil y abre el modal ────────────
    const btnCambiarContrasena = document.getElementById('btnCambiarContrasena');
    if (btnCambiarContrasena) {
        btnCambiarContrasena.addEventListener('click', function (e) {
            e.preventDefault();
            window.location.href = '/conductor/perfil?accion=cambiar-contrasena';
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
});


// ── Cierra el select personalizado al hacer clic fuera ────────────────────────
document.addEventListener('click', function (e) {
    const sel = document.getElementById('tipoVehiculoSelect');
    if (sel && !sel.contains(e.target)) sel.classList.remove('open');
});

// ── Delegación global para editar y eliminar desde las tarjetas ───────────────
document.addEventListener('click', function (e) {
    const btnEditar = e.target.closest('.btn-editar-vehiculo');
    const btnEliminar = e.target.closest('.btn-eliminar-vehiculo');

    if (btnEditar) {
        abrirModalEditar(
            btnEditar.dataset.id,
            btnEditar.dataset.placa,
            btnEditar.dataset.tipo
        );
    }

    if (btnEliminar) {
        confirmarEliminar(btnEliminar.dataset.id, btnEliminar.dataset.placa);
    }
});


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


/**
 * Carga el catálogo de tipos de vehículo en el select personalizado.
 */
async function cargarTiposVehiculo() {
    try {
        const res = await fetch('/api/vehiculos/tipos', { credentials: 'same-origin' });
        if (!res.ok) return;
        const tipos = await res.json();

        const contenedor = document.getElementById('tipoVehiculoOptions');
        if (!contenedor) return;

        contenedor.innerHTML = tipos.map(t =>
            `<div class="custom-select__option"
                  data-value="${t.id_tipo_vehiculo}"
                  data-texto="${t.descripcion}">
                ${t.descripcion}
             </div>`
        ).join('');

        contenedor.querySelectorAll('.custom-select__option').forEach(opt => {
            opt.addEventListener('click', function () {
                contenedor.querySelectorAll('.custom-select__option')
                    .forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');

                document.getElementById('tipoVehiculoText').textContent = this.dataset.texto;
                document.getElementById('tipoVehiculoText').style.color = 'var(--clr-on-surface)';
                document.getElementById('selectTipoVehiculo').value = this.dataset.value;
                document.getElementById('selectTipoVehiculoTexto').value = this.dataset.texto;

                document.getElementById('tipoVehiculoSelect').classList.remove('open');
                toggleCampoPlaca(this.dataset.texto);
            });
        });

    } catch (_) { }
}


/**
 * Carga y renderiza los vehículos activos del usuario.
 */
async function cargarVehiculos() {
    try {
        const res = await fetch('/api/vehiculos', { credentials: 'same-origin' });

        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }

        if (!res.ok) return;

        const vehiculos = await res.json();
        renderizarVehiculos(vehiculos);
    } catch (_) { }
}


/**
 * Inyecta las tarjetas de vehículos en el contenedor.
 */
function renderizarVehiculos(vehiculos) {
    const contenedor = document.getElementById('vehiculosContainer');
    const estadoVacio = document.getElementById('estadoVacio');
    if (!contenedor) return;

    const activos = vehiculos.filter(v => v.estado === 'activo');

    if (activos.length === 0) {
        contenedor.innerHTML = '';
        if (estadoVacio) estadoVacio.style.display = 'block';
        return;
    }

    if (estadoVacio) estadoVacio.style.display = 'none';

    contenedor.innerHTML = activos.map(v => {
        const icono = ICONOS_VEHICULO[v.tipo_vehiculo] || 'directions_car';
        return `
        <div class="col-12 col-md-6 col-lg-4">
            <div class="vehiculo-card">
                <div class="vehiculo-icono">
                    <span class="material-symbols-outlined">${icono}</span>
                </div>
                <div class="vehiculo-info">
                    <div class="vehiculo-placa">${v.placa}</div>
                    <div class="vehiculo-tipo">${v.tipo_vehiculo}</div>
                    <span class="vehiculo-badge activo">Activo</span>
                </div>
                <div class="vehiculo-acciones">
                    <button class="btn-vehiculo-accion editar btn-editar-vehiculo"
                        data-id="${v.id_vehiculo}"
                        data-placa="${v.placa}"
                        data-tipo="${v.id_tipo_vehiculo}"
                        title="Editar">
                        <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button class="btn-vehiculo-accion eliminar btn-eliminar-vehiculo"
                        data-id="${v.id_vehiculo}"
                        data-placa="${v.placa}"
                        title="Eliminar">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}


/**
 * Abre el modal en modo creación.
 */
function abrirModalAgregar() {
    document.getElementById('vehiculoId').value = '';
    document.getElementById('inputPlaca').value = '';
    document.getElementById('selectTipoVehiculo').value = '';
    document.getElementById('selectTipoVehiculoTexto').value = '';
    document.getElementById('tipoVehiculoText').textContent = 'Selecciona un tipo';
    document.getElementById('tipoVehiculoText').style.color = 'var(--clr-on-surface-var)';
    document.querySelectorAll('#tipoVehiculoOptions .custom-select__option')
        .forEach(o => o.classList.remove('selected'));
    document.getElementById('campoPlaca').style.display = 'block';
    document.getElementById('modalVehiculoLabel').textContent = 'Agregar vehículo';
    document.getElementById('btnGuardarVehiculo').textContent = 'Guardar';

    const el = document.getElementById('modalVehiculo');
    const instanciaPrevia = bootstrap.Modal.getInstance(el);
    if (instanciaPrevia) instanciaPrevia.dispose();
    new bootstrap.Modal(el).show();
}

/**
 * Abre el modal en modo edición con los datos del vehículo seleccionado.
 */
function abrirModalEditar(id, placa, idTipo) {
    document.getElementById('vehiculoId').value = id;
    document.getElementById('inputPlaca').value = placa;
    document.getElementById('selectTipoVehiculo').value = idTipo;

    const opciones = document.querySelectorAll('#tipoVehiculoOptions .custom-select__option');
    let textoSeleccionado = '';
    opciones.forEach(o => {
        o.classList.remove('selected');
        if (o.dataset.value === String(idTipo)) {
            o.classList.add('selected');
            textoSeleccionado = o.dataset.texto;
        }
    });

    document.getElementById('tipoVehiculoText').textContent = textoSeleccionado || 'Selecciona un tipo';
    document.getElementById('tipoVehiculoText').style.color = textoSeleccionado
        ? 'var(--clr-on-surface)' : 'var(--clr-on-surface-var)';
    document.getElementById('selectTipoVehiculoTexto').value = textoSeleccionado;

    toggleCampoPlaca(textoSeleccionado);

    document.getElementById('modalVehiculoLabel').textContent = 'Editar vehículo';
    document.getElementById('btnGuardarVehiculo').textContent = 'Guardar cambios';

    const el = document.getElementById('modalVehiculo');
    const instanciaPrevia = bootstrap.Modal.getInstance(el);
    if (instanciaPrevia) instanciaPrevia.dispose();
    new bootstrap.Modal(el).show();
}


/**
 * Determina si el modal está en modo edición o creación y ejecuta
 * la operación correspondiente.
 */
/**
 * Determina si el modal está en modo edición o creación y ejecuta
 * la operación correspondiente.
 */
async function guardarVehiculo() {
    const id = document.getElementById('vehiculoId').value;
    const idTipo = document.getElementById('selectTipoVehiculo').value;
    let placa = document.getElementById('inputPlaca').value.trim().toUpperCase();

    if (!idTipo) {
        swalError('Campos incompletos', 'Selecciona un tipo de vehículo.');
        return;
    }

    // ID numérico exacto de Bicicleta en su base de datos (ID: 3)
    const esBicicleta = parseInt(idTipo) === 3;

    // CORRECCIÓN: Si es bicicleta, no vaciamos ni forzamos 'N/A' en el JS,
    // simplemente dejamos que viaje vacío o con lo que tenga, ya que el backend generará el código único.
    if (!esBicicleta && !placa) {
        swalError('Campos incompletos', 'La placa es obligatoria.');
        return;
    }

    const esEdicion = id !== '';
    const url = esEdicion ? `/api/vehiculos/${id}` : '/api/vehiculos';
    const metodo = esEdicion ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method: metodo,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_tipo_vehiculo: parseInt(idTipo),
                placa: esBicicleta ? '' : placa // Enviamos cadena vacía si es bicicleta para mantener el orden
            })
        });

        const data = await res.json();

        bootstrap.Modal.getInstance(document.getElementById('modalVehiculo'))?.hide();

        if (!res.ok) {
            swalError('Error', data.error || 'No se pudo completar la operación.');
            return;
        }

        swalExito(esEdicion ? 'Vehículo actualizado' : 'Vehículo registrado', data.mensaje);
        cargarVehiculos();

    } catch (_) {
        swalError('Error de conexión', 'No se pudo conectar con el servidor.');
    }
}

/**
 * Muestra confirmación SweetAlert2 antes de eliminar un vehículo.
 */
function confirmarEliminar(id, placa) {
    Swal.fire({
        title: `¿Eliminar ${placa}?`,
        text: 'El vehículo será desactivado de tu cuenta.',
        icon: 'warning',
        background: '#001f2e',
        color: '#e0e0e0',
        showCancelButton: true,
        showCloseButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ff5252',
        cancelButtonColor: '#91f78e',
        didOpen: () => {
            const popup = Swal.getPopup();
            if (popup) {
                popup.style.border = '2px solid #ff5252';
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
    }).then(async (result) => {
        if (!result.isConfirmed) return;
        try {
            const res = await fetch(`/api/vehiculos/${id}`, {
                method: 'DELETE',
                credentials: 'same-origin'
            });
            const data = await res.json();
            if (!res.ok) {
                swalError('Error', data.error || 'No se pudo eliminar el vehículo.');
                return;
            }
            swalExito('Vehículo eliminado', data.mensaje);
            cargarVehiculos();
        } catch (_) {
            swalError('Error de conexión', 'No se pudo conectar con el servidor.');
        }
    });
}


/**
 * Cierra la sesión del usuario.
 */
async function cerrarSesion() {
    try {
        await fetch('/api/usuario/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
        window.location.href = '/login';
    }
}


// ── Helpers SweetAlert2 ───────────────────────────────────────────────────────

function swalExito(titulo, texto) {
    Swal.fire({
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
    Swal.fire({
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
