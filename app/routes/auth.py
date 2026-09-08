"""
Módulo de autenticación de Parquéate Cerca.
Maneja el registro, login, recuperación de contraseña
y verificación de código OTP. 
"""
from flask import Blueprint, render_template, request, redirect, url_for, session, jsonify, current_app
from werkzeug.security import generate_password_hash, check_password_hash # cifrado de contraseñas
from app.correo import enviar_correo
from datetime import datetime, timedelta # manejo de fechas y tiempo
from app import get_db          # función conexión a PostgreSQL (Supabase)
import psycopg2                 # manejador de errores de base de datos
import random                   # generación del código OTP
import re                       # validación del formato de contraseña
import math
# Blueprint  que agrupa todas las rutas de autenticación
auth_bp = Blueprint('auth', __name__)
# Traduce el valor del selector de perfil (login.html) al nombre
# exacto almacenado en tipo_perfil.descripcion

def validar_contrasena(contrasena):
    """
    Valida que una contraseña cumpla los requisitos mínimos de
    seguridad exigidos por RNF_SEG_01: mínimo 8 caracteres, al menos
    una mayúscula y al menos un carácter especial.

    Recibe:
        - contrasena: str

    Retorna:
        str: mensaje de error si no cumple algún requisito
        None: si la contraseña es válida
    """
    if len(contrasena) < 8:
        return 'La contraseña debe tener mínimo 8 caracteres'
    if not re.search(r'[A-Z]', contrasena):
        return 'La contraseña debe incluir al menos una letra mayúscula'
    if not re.search(r'[^A-Za-z0-9]', contrasena):
        return 'La contraseña debe incluir al menos un carácter especial'
    return None

def _generar_codigo_otp():
    """
    Genera un código OTP numérico de 6 dígitos, permitiendo ceros a
    la izquierda (0 a 999999) y rellenando con zfill para que
    siempre tenga 6 caracteres, igual que las 6 casillas del
    formulario en codigo.html.
    """
    return str(random.randint(0, 999999)).zfill(6)


def _emitir_otp(cursor, id_usuario):
    """
    Genera un nuevo código OTP para un usuario y lo guarda en la
    tabla otp, lista para usarse tanto en /api/recuperar como en
    /api/reenviar-codigo.

    Invalida primero cualquier código anterior sin usar del mismo
    usuario, para que nunca queden dos códigos "vigentes" a la vez
    (evita que el usuario se confunda leyendo un correo viejo).

    La fecha de expiración se calcula con NOW() de Postgres, no con
    datetime.now() de Python: si se calculara en Python, el
    vencimiento dependería de la zona horaria del reloj del
    servidor donde corra Flask. En el equipo local esa hora
    coincide con Bogotá, pero en Render el contenedor corre en UTC,
    así que el código quedaba comparado contra un NOW() de la BD
    calculado en otra referencia horaria y el OTP podía darse por
    inválido o expirado aunque el dígito ingresado fuera correcto.
    Calculando fecha_expira directamente en la consulta SQL, todo
    queda en la misma línea de tiempo del propio Postgres.

    Recibe:
        - cursor: cursor abierto de la conexión a la BD
        - id_usuario: id del usuario para el que se genera el código

    Retorna:
        str: el código OTP generado, listo para enviarse por correo
    """
    codigo = _generar_codigo_otp()

    cursor.execute("""
        UPDATE otp SET usado = 1
        WHERE id_usuario = %s AND usado = 0
    """, (id_usuario,))

    cursor.execute("""
        INSERT INTO otp (id_usuario, codigo, fecha_expira)
        VALUES (%s, %s, NOW() + INTERVAL '10 minutes')
    """, (id_usuario, codigo))

    return codigo

MAPA_PERFILES = {
    'driver': 'Conductor',
    'owner': 'Administrador'
}

# —— Páginas HTML ——————————————————————————————————————————————————————————————

@auth_bp.route('/')
def index():
    """Renderiza la página principal (landing page)."""
    return render_template('index.html')

@auth_bp.route('/registro')
def registro():
    """Renderiza la página de registro de nuevo usuario."""
    return render_template('auth/registro.html')


@auth_bp.route('/login')
def login():
    """Renderiza la página de inicio de sesión."""
    return render_template('auth/login.html')

@auth_bp.route('/recuperar')
def recuperar():
    """Renderiza la página para solicitar recuperación de contraseña"""
    return render_template('auth/recuperar.html')

@auth_bp.route('/codigo')
def codigo():
    """Renderiza la página para ingresar el código OTP."""
    return render_template('auth/codigo.html')

@auth_bp.route('/nueva-contrasena')
def nueva_contrasena():
    """Renderiza la página para establecer una nueva contraseña."""
    return render_template('auth/n_contrasena.html')

# —— API de autenticación ——————————————————————————————————————————————————————
@auth_bp.route('/api/registro', methods=['POST'])
def api_registro():
    """
    Registra un nuevo usuario conductor en el sistema.

    Recibe (JSON):
        - id_tipo_documento: ID del tipo de documento (1=CC, 2=TI, 3=CE, 4=PA)
        - numero_documento: Número de documento (7-15 dígitos)
        - nombres: Nombres del usuario
        - apellidos: Apellidos del usuario
        - telefono: Teléfono del usuario
        - correo: Correo electrónico único
        - contrasena: Contraseña (mínimo 8 caracteres, una mayúscula y un especial)

    Retorna:
        201: Registro exitoso, sesión iniciada
        400: Datos inválidos o duplicados
        500: Error interno del servidor
    """
    # Obtiene los datos enviados en formato JSON desde el formulario
    datos = request.get_json()

    # Extrae cada campo del JSON recibido
    id_tipo_documento = datos.get('id_tipo_documento')
    numero_documento = datos.get('numero_documento')
    nombres = datos.get('nombres')
    telefono = datos.get('telefono')
    apellidos = datos.get('apellidos')
    correo = datos.get('correo')
    contrasena = datos.get('contrasena')

    # Verifica que ningún campo esté vacío
    # all() retorna True solo si todos los valores son verdaderos (no vacíos)
    if not all([id_tipo_documento, numero_documento, nombres, apellidos, telefono, correo, contrasena]):
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400

    error_contrasena = validar_contrasena(contrasena)
    if error_contrasena:
        return jsonify({'error': error_contrasena}), 400
    
    try:
        # Abre la conexión con la base de datos
        db = get_db(current_app)
        cursor = db.cursor()

        # Verifica si el correo ya está registrado en la BD
        cursor.execute('SELECT id_usuario FROM usuario WHERE correo = %s', (correo,))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El correo ya está registrado'}), 400

        # Verifica si el número de documento ya está registrado
        cursor.execute("SELECT id_usuario FROM usuario WHERE numero_documento = %s", (numero_documento,))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El número de documento ya está registrado'}), 400
        
        # Verifica si el teléfono ya está registrado
        cursor.execute("SELECT id_usuario FROM usuario WHERE telefono = %s", (telefono,))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El teléfono ya está registrado'}), 400
        
        # Convierte la contraseña en un hash seguro antes de guardarla
        # Nunca se guarda la contraseña en texto plano
        contrasena_hash = generate_password_hash(contrasena)

        # Inserta el nuevo usuario en la tabla usuario
        # id_perfil_activo = 1 porque todo usuario nuevo es Conductor
        cursor.execute("""
            INSERT INTO usuario (id_tipo_documento, id_perfil_activo, numero_documento,
                nombres, apellidos, telefono, correo, contrasena_hash)
            VALUES (%s, 1, %s, %s, %s, %s, %s, %s)
            RETURNING id_usuario
        """, (id_tipo_documento, numero_documento, nombres, apellidos, telefono, correo, contrasena_hash))

        id_usuario = cursor.fetchone()['id_usuario']

        # Inserta el perfil Conductor en la tabla usuario_perfil
        # Esta tabla permite que un usuario tenga múltiples perfiles
        cursor.execute("""
            INSERT INTO usuario_perfil (id_usuario, id_tipo_perfil)
            VALUES (%s, 1)
        """, (id_usuario,))

        # Confirma los cambios en la base de datos
        db.commit()
        cursor.close()
        db.close()

        # Guarda los datos del usuario en la sesión
        # Esto equivale a iniciar sesión automáticamente tras el registro
        session['id_usuario'] = id_usuario
        session['nombres'] = nombres
        session['perfil'] = 'Conductor'

        return jsonify({'mensaje': 'Registro exitoso'}), 201
    
    except Exception as e:
        # Captura cualquier error inesperado y lo retorna
        return jsonify({'error': str(e)}), 500

@auth_bp.route('/api/login', methods=['POST'])
def api_login():
    """
    Inicia sesión de un usuario. Bloquea la cuenta 5 minutos después
    de 3 intentos fallidos consecutivos (protección contra fuerza
    bruta). El bloqueo se evalúa comparando fechas dentro de la
    propia consulta SQL, no en Python, para evitar depender del reloj
    del servidor Flask (ver el bug de zona horaria que ya tuvimos con
    fecha_hora_entrada en movimiento).

    Recibe (JSON):
        - correo: Correo electrónico registrado
        - contrasena: Contraseña del usuario
        - perfil: Tipo de perfil seleccionado (driver/owner)

    Retorna:
        200: Login exitoso con el perfil del usuario
        400: Campos vacíos o perfil no válido
        401: Credenciales incorrectas (incluye intentos restantes)
        403: El usuario no tiene el perfil seleccionado habilitado
        423: Cuenta bloqueada temporalmente por intentos fallidos
        500: Error de base de datos
    """
    datos = request.get_json()
    correo = datos.get('correo')
    contrasena = datos.get('contrasena')
    perfil_solicitado = datos.get('perfil')

    if not correo or not contrasena or not perfil_solicitado:
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400

    perfil = MAPA_PERFILES.get(perfil_solicitado)
    if not perfil:
        return jsonify({'error': 'Perfil no válido'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # esta_bloqueado y segundos_restantes se calculan con NOW() de
        # MySQL, no con datetime.now() de Python, para que el bloqueo
        # sea consistente sin importar el reloj/zona horaria del
        # servidor Flask
        cursor.execute("""
            SELECT *,
                   bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW() AS esta_bloqueado,
                   EXTRACT(EPOCH FROM (bloqueado_hasta - NOW())) AS segundos_restantes
            FROM usuario
            WHERE correo = %s AND estado = 'activo'
        """, (correo,))
        usuario = cursor.fetchone()

        if not usuario:
            cursor.close()
            db.close()
            return jsonify({'error': 'Correo o contraseña incorrectos'}), 401

        if usuario['esta_bloqueado']:
            minutos_restantes = max(1, math.ceil(usuario['segundos_restantes'] / 60))
            cursor.close()
            db.close()
            return jsonify({
                'error': f'Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta de nuevo en {minutos_restantes} minuto(s).'
            }), 423

        # Contraseña incorrecta: incrementa el contador y, al llegar a
        # 3, activa el bloqueo de 5 minutos y reinicia el contador
        if not check_password_hash(usuario['contrasena_hash'], contrasena):
            nuevos_intentos = usuario['intentos_fallidos'] + 1

            if nuevos_intentos >= 3:
                cursor.execute("""
                    UPDATE usuario
                    SET intentos_fallidos = 0, bloqueado_hasta = NOW() + INTERVAL '5 minutes'
                    WHERE id_usuario = %s
                """, (usuario['id_usuario'],))
                db.commit()
                cursor.close()
                db.close()
                return jsonify({
                    'error': 'Cuenta bloqueada temporalmente por 3 intentos fallidos. Intenta de nuevo en 5 minutos.'
                }), 423

            cursor.execute("""
                UPDATE usuario SET intentos_fallidos = %s WHERE id_usuario = %s
            """, (nuevos_intentos, usuario['id_usuario']))
            db.commit()
            cursor.close()
            db.close()

            intentos_restantes = 3 - nuevos_intentos
            return jsonify({
                'error': f'Correo o contraseña incorrectos. Te quedan {intentos_restantes} intento(s) antes de que se bloquee tu cuenta.'
            }), 401

        # Verifica que el usuario tenga asignado el perfil que seleccionó
        # en el formulario de login (tabla usuario_perfil, RF_02 / RF_05)
        cursor.execute("""
            SELECT tp.id_tipo_perfil
            FROM usuario_perfil up
            JOIN tipo_perfil tp ON up.id_tipo_perfil = tp.id_tipo_perfil
            WHERE up.id_usuario = %s AND tp.descripcion = %s AND up.estado = 'activo'
        """, (usuario['id_usuario'], perfil))
        perfil_asignado = cursor.fetchone()

        if not perfil_asignado:
            cursor.close()
            db.close()
            return jsonify({'error': f'No tienes el perfil {perfil} habilitado'}), 403

        # Login exitoso: actualiza el perfil activo y limpia cualquier
        # rastro de intentos fallidos previos
        cursor.execute("""
            UPDATE usuario
            SET id_perfil_activo = %s, intentos_fallidos = 0, bloqueado_hasta = NULL
            WHERE id_usuario = %s
        """, (perfil_asignado['id_tipo_perfil'], usuario['id_usuario']))
        db.commit()

        # Si el perfil seleccionado es Administrador, resuelve de una vez
        # el parqueadero asociado a este usuario y lo deja listo para
        # guardarlo en sesión. Se hace ANTES de cerrar cursor/db porque
        # necesita la misma conexión abierta.
        id_parqueadero = None
        if perfil == 'Administrador':
            cursor.execute("""
                SELECT id_parqueadero FROM parqueadero
                WHERE id_usuario = %s AND estado = 'activo'
            """, (usuario['id_usuario'],))
            parqueadero = cursor.fetchone()
            if parqueadero:
                id_parqueadero = parqueadero['id_parqueadero']

        cursor.close()
        db.close()

        session['id_usuario'] = usuario['id_usuario']
        session['nombres'] = usuario['nombres']
        session['perfil'] = perfil

        if id_parqueadero:
            session['id_parqueadero'] = id_parqueadero

        return jsonify({'mensaje': 'Login exitoso', 'perfil': perfil}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error en login: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500
    
@auth_bp.route('/api/recuperar', methods=['POST'])
def api_recuperar():
    """
    Genera y envía un código OTP al correo del usuario
    para iniciar el proceso de recuperación de contraseña.

    Recibe (JSON):
        - correo: Correo electrónico registrado

    Retorna:
        200: Código enviado exitosamente
        400: Correo vacío
        404: Correo no registrado
        500: Error de base de datos o al enviar correo
    """

    datos = request.get_json()
    correo = datos.get('correo')

    if not correo:
        return jsonify({'error': 'El correo es obligatorio'}), 400
    
    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Verifica que el correo exista y el usuario esté activo
        cursor.execute("SELECT id_usuario FROM usuario WHERE correo = %s AND estado = 'activo'", (correo,))
        usuario = cursor.fetchone()

        if not usuario:
            cursor.close()
            db.close()
            return jsonify({'error': 'El correo no está registrado'}), 404

        # Genera un número aleatorio de 6 dígitos como código OTP
        codigo = str(random.randint(100000, 999999))

        # Calcula la fecha de expiración: 10 minutos desde ahora
        fecha_expira = datetime.now() + timedelta(minutes=10)

        # Guarda el OTP en la BD para verificarlo después
        cursor.execute("""
            INSERT INTO otp (id_usuario, codigo, fecha_expira)
            VALUES (%s, %s, %s)
        """, (usuario['id_usuario'], codigo, fecha_expira))

        db.commit()
        cursor.close()
        db.close()

        enviado = enviar_correo(
            correo,
            'Código de recuperación - Parquéate Cerca',
            f'Tu código de verificación es: {codigo}\nExpira en 10 minutos.'
        )
        if not enviado:
            return jsonify({'error': 'Error al enviar el correo'}), 500

        # Guarda el correo en sesión para usarlo en los siguientes pasos
        # sin necesidad de pedírselo al usuario otra vez
        session['correo_recuperacion'] = correo

        return jsonify({'mensaje': 'Código enviado exitosamente'}), 200
    
    except psycopg2.Error as e:
        return jsonify({'error': 'Error de base de datos'}), 500
    except Exception as e:
        return jsonify({'error': 'Error al enviar el correo'}), 500
    
@auth_bp.route('/api/verificar-codigo', methods=['POST'])
def api_verificar_codigo():
    """
    Verifica que el código OTP ingresado sea válido,
    no haya sido usado y no haya expirado.

    Recibe (JSON):
        - codigo: Código OTP de 6 dígitos

    Retorna:
        200: Código verificado correctamente
        400: Código vacío, inválido o expirado
        404: Usuario no encontrado
        500: Error de base de datos
    """
    datos = request.get_json()
    codigo = datos.get('codigo')

    if not codigo:
        return jsonify({'error': 'El código es obligatorio'}), 400
    # Recupera el correo guardado en sesión en el paso anterior
    correo = session.get('correo_recuperacion')
    if not correo:
        return jsonify({'error': 'Sesión expirada, vuelve a solicitar el código'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Busca el usuario por el correo guardado en sesión
        cursor.execute("SELECT id_usuario FROM usuario WHERE correo = %s", (correo,))
        usuario = cursor.fetchone()

        if not usuario:
            cursor.close()
            db.close()
            return jsonify({'error': 'Usuario no encontrado'}), 404

        # Busca el OTP más reciente que:
        # - pertenezca al usuario
        # - coincida con el código ingresado
        # - no haya sido usado (usado = 0)
        # - no haya expirado (fecha_expira > NOW())
        cursor.execute("""
            SELECT id_otp FROM otp
            WHERE id_usuario = %s
            AND codigo = %s
            AND usado = 0
            AND fecha_expira > NOW()
            ORDER BY fecha_creacion DESC
            LIMIT 1
        """, (usuario['id_usuario'], codigo))
        otp = cursor.fetchone()

        if not otp:
            cursor.close()
            db.close()
            return jsonify({'error': 'Código inválido o expirado'}), 400

        # Marca el OTP como usado para que no pueda reutilizarse
        cursor.execute("UPDATE otp SET usado = 1 WHERE id_otp = %s", (otp['id_otp'],))
        db.commit()
        cursor.close()
        db.close()

        # Marca en sesión que el OTP fue verificado correctamente
        # Esto protege la ruta de nueva contraseña
        session['otp_verificado'] = True

        return jsonify({'mensaje': 'Código verificado correctamente'}), 200

    except psycopg2.Error as e:
        return jsonify({'error': 'Error de base de datos'}), 500


@auth_bp.route('/api/nueva-contrasena', methods=['POST'])
def api_nueva_contrasena():
    """
    Actualiza la contraseña del usuario tras verificar el OTP.

    Recibe (JSON):
        - contrasena: Nueva contraseña
        - confirmar: Confirmación de la nueva contraseña

    Retorna:
        200: Contraseña actualizada correctamente
        400: Campos vacíos, contraseñas no coinciden o sesión expirada
        401: No pasó por la verificación del OTP
        500: Error de base de datos
    """
    datos = request.get_json()
    contrasena = datos.get('contrasena')
    confirmar = datos.get('confirmar')

    if not contrasena or not confirmar:
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400

    if contrasena != confirmar:
        return jsonify({'error': 'Las contraseñas no coinciden'}), 400

    error_contrasena = validar_contrasena(contrasena)
    if error_contrasena:
        return jsonify({'error': error_contrasena}), 400

    # Verifica que el usuario pasó por la verificación del OTP
    # Si alguien intenta acceder directamente a esta ruta sin verificar, se bloquea
    if not session.get('otp_verificado'):
        return jsonify({'error': 'No autorizado'}), 401

    # Recupera el correo guardado en sesión
    correo = session.get('correo_recuperacion')
    if not correo:
        return jsonify({'error': 'Sesión expirada, vuelve a solicitar el código'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Genera el hash de la nueva contraseña
        contrasena_hash = generate_password_hash(contrasena)

        # Actualiza la contraseña en la BD
        cursor.execute("""
            UPDATE usuario SET contrasena_hash = %s
            WHERE correo = %s
        """, (contrasena_hash, correo))

        db.commit()
        cursor.close()
        db.close()

        # Limpia los datos de recuperación de la sesión
        # Ya no son necesarios y es buena práctica eliminarlos
        session.pop('correo_recuperacion', None)
        session.pop('otp_verificado', None)

        return jsonify({'mensaje': 'Contraseña actualizada correctamente'}), 200

    except psycopg2.Error as e:
        return jsonify({'error': 'Error de base de datos'}), 500
