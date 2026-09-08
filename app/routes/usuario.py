"""
Módulo de gestión de usuario de Parquéate Cerca.
Maneja la consulta, modificación, cambio de contraseña, 
eliminación de cuenta y cierre de sesión del usuario logueado.
"""
from flask import Blueprint, render_template, request, redirect, url_for, session, jsonify, current_app
from werkzeug.security import generate_password_hash, check_password_hash  # cifrado de contraseñas
from app import get_db          # función de conexión a PostgreSQL (Supabase)
from app.routes.auth import validar_contrasena  # validación de formato de contraseña
from app.correo import enviar_correo
import psycopg2                 # manejador de errores de base de datos

from functools import wraps
import re

_CORREO_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

# —— Validación de Rol ——————————————————————————————————————————————————————
def rol_administrador_requerido(f):
    """
    Verifica que el usuario tenga sesión activa y su perfil activo
    sea Administrador (id_perfil_activo = 2). Redirige al login si no
    hay sesión, o al dashboard del conductor si no tiene el rol.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get('id_usuario'):
            return redirect(url_for('auth.login'))
        if session.get('perfil') != 'Administrador':
            return redirect(url_for('usuario.vista_mapa'))
        return f(*args, **kwargs)
    return wrapper

# Blueprint que agrupa todas las rutas de gestión de usuario
usuario_bp = Blueprint('usuario', __name__)


# —— Rutas de renderizado ——————————————————————————————————————————————————————

@usuario_bp.route('/conductor/perfil')
def vista_perfil():
    """
    Renderiza la vista del perfil del conductor.
    Redirige al login si no hay sesión activa.
    """
    if not session.get('id_usuario'):
        return redirect(url_for('auth.login'))
    return render_template('conductor/perfil.html')

@usuario_bp.route('/conductor/vehiculos')
def vista_vehiculos():
    """
    Renderiza la vista de gestión de vehículos del conductor.
    Redirige al login si no hay sesión activa.
    """
    if not session.get('id_usuario'):
        return redirect(url_for('auth.login'))
    return render_template('conductor/vehiculos.html')

@usuario_bp.route('/conductor/parqueadero/registrar')
def vista_registrar_parqueadero():
    """
    Renderiza el formulario de registro de parqueadero.
    Solo accesible si el conductor no tiene parqueadero activo aún.
    Redirige al login si no hay sesión activa.
    """
    if not session.get('id_usuario'):
        return redirect(url_for('auth.login'))
    return render_template('administrador/registrar_parqueadero.html')

@usuario_bp.route('/administrador/movimientos')
@rol_administrador_requerido
def vista_movimientos():
    """
    Renderiza la vista de movimientos e historial del parqueadero.
    Solo accesible para usuarios con perfil activo Administrador.
    """
    return render_template('administrador/movimientos.html')

# ── Detalle público de parqueadero (vista del conductor) ────────────────────

@usuario_bp.route('/conductor/parqueadero/<int:id_parqueadero>')
def vista_detalles_parqueadero(id_parqueadero):
    """
    Renderiza la vista de detalles de un parqueadero para el conductor
    (RF_17). La existencia del parqueadero la resuelve el propio JS al
    consumir la API y muestra un estado de error si no encuentra nada.
    """
    if not session.get('id_usuario'):
        return redirect(url_for('auth.login'))
    return render_template('conductor/detalles_parqueadero.html', id_parqueadero=id_parqueadero)


@usuario_bp.route('/api/parqueaderos/<int:id_parqueadero>', methods=['GET'])
def api_detalle_parqueadero(id_parqueadero):
    """
    Retorna el detalle público de un parqueadero para la vista del
    conductor: datos generales, fotos, cupos por tipo de vehículo,
    horario general, servicios con su horario propio, y el resumen
    de calificaciones (promedio y total, RF_19/RF_20).

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Retorna:
        200: Objeto con el detalle del parqueadero
        401: No hay sesión activa
        404: El parqueadero no existe o está inactivo
        500: Error de base de datos
    """
    if not session.get('id_usuario'):
        return jsonify({'error': 'No hay sesión activa'}), 401

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT id_parqueadero, nombre, direccion, descripcion,
                   correo, telefono, capacidad_total, latitud, longitud
            FROM parqueadero
            WHERE id_parqueadero = %s AND estado = 'activo'
        """, (id_parqueadero,))
        parqueadero = cursor.fetchone()

        if not parqueadero:
            cursor.close()
            db.close()
            return jsonify({'error': 'El parqueadero no existe o no está activo'}), 404

        cursor.execute("""
            SELECT id_imagen, ruta_archivo, orden
            FROM imagen_parqueadero
            WHERE id_parqueadero = %s
            ORDER BY orden
        """, (id_parqueadero,))
        fotos = cursor.fetchall()

        cursor.execute("""
            SELECT tv.id_tipo_vehiculo, tv.descripcion,
                   COALESCE(c.cupo_total, 0) AS cupo_total,
                   COALESCE(c.cupo_disponible, 0) AS cupo_disponible
            FROM tipo_vehiculo tv
            LEFT JOIN cupo c
                ON c.id_tipo_vehiculo = tv.id_tipo_vehiculo
                AND c.id_parqueadero = %s
            WHERE tv.estado = 'activo'
            ORDER BY tv.id_tipo_vehiculo
        """, (id_parqueadero,))
        cupos = cursor.fetchall()

        cursor.execute("""
            SELECT ts.descripcion,
                   h.dia_inicial, h.dia_final, h.hora_inicial, h.hora_final
            FROM parqueadero_servicio ps
            JOIN tipo_servicio ts ON ps.id_tipo_servicio = ts.id_tipo_servicio
            LEFT JOIN horario h ON h.id_parqueadero_servicio = ps.id_parqueadero_servicio
            WHERE ps.id_parqueadero = %s
        """, (id_parqueadero,))
        servicios = cursor.fetchall()
        for servicio in servicios:
            servicio['hora_inicial'] = timedelta_a_hora(servicio['hora_inicial'])
            servicio['hora_final'] = timedelta_a_hora(servicio['hora_final'])

        cursor.execute("""
            SELECT dia_inicial, dia_final, hora_inicial, hora_final
            FROM horario
            WHERE id_parqueadero = %s AND id_parqueadero_servicio IS NULL
        """, (id_parqueadero,))
        horario_general = cursor.fetchone()
        if horario_general:
            horario_general['hora_inicial'] = timedelta_a_hora(horario_general['hora_inicial'])
            horario_general['hora_final'] = timedelta_a_hora(horario_general['hora_final'])

        # Promedio y total de calificaciones (RF_19 / RF_20)
        cursor.execute("""
            SELECT ROUND(AVG(tc.valor), 1) AS promedio, COUNT(*) AS total
            FROM calificacion cal
            JOIN tipo_calificacion tc ON cal.id_tipo_calificacion = tc.id_tipo_calificacion
            WHERE cal.id_parqueadero = %s
        """, (id_parqueadero,))
        resumen = cursor.fetchone()

        cursor.close()
        db.close()

        parqueadero['fotos'] = fotos
        parqueadero['cupos'] = cupos
        parqueadero['servicios'] = servicios
        parqueadero['horario_general'] = horario_general
        parqueadero['promedio_calificacion'] = float(resumen['promedio']) if resumen['promedio'] else 0
        parqueadero['total_calificaciones'] = resumen['total']

        return jsonify(parqueadero), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al obtener detalle del parqueadero: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/parqueaderos/<int:id_parqueadero>/calificaciones', methods=['GET'])
def api_listar_calificaciones(id_parqueadero):
    """
    Retorna las reseñas de un parqueadero (RF_19/RF_20), más recientes
    primero, e indica si el usuario logueado ya tiene una reseña
    propia (campo 'propia'), para que el frontend abra el formulario
    en modo edición en vez de creación.

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Retorna:
        200: { calificaciones: [...], propia: {...} | null }
        401: No hay sesión activa
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT cal.id_calificacion, cal.id_usuario, u.nombres, u.apellidos,
                   tc.valor, cal.resena, cal.fecha_calificacion
            FROM calificacion cal
            JOIN usuario u ON cal.id_usuario = u.id_usuario
            JOIN tipo_calificacion tc ON cal.id_tipo_calificacion = tc.id_tipo_calificacion
            WHERE cal.id_parqueadero = %s
            ORDER BY cal.fecha_calificacion DESC
        """, (id_parqueadero,))
        calificaciones = cursor.fetchall()

        for cal in calificaciones:
            cal['fecha_calificacion'] = datetime_a_texto(cal['fecha_calificacion'])

        cursor.close()
        db.close()

        propia = next((c for c in calificaciones if c['id_usuario'] == id_usuario), None)

        return jsonify({'calificaciones': calificaciones, 'propia': propia}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al listar calificaciones: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/parqueaderos/<int:id_parqueadero>/calificaciones', methods=['POST'])
def api_calificar_parqueadero(id_parqueadero):
    """
    Crea o actualiza la calificación del conductor logueado sobre un
    parqueadero (RF_20). Solo puede calificar si tiene al menos un
    movimiento con salida registrada en ese parqueadero (estado
    'retirado'), conforme a la redacción del requerimiento: la reseña
    se otorga "una vez se registre la salida de su vehículo".

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Recibe (JSON):
        - valor: entero de 1 a 3 (escala de tipo_calificacion)
        - resena: texto opcional, máximo 200 caracteres

    Retorna:
        201/200: Reseña creada / actualizada
        400: Valor fuera de rango o reseña demasiado larga
        401: No hay sesión activa
        403: El conductor no tiene una salida registrada en este parqueadero
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    datos = request.get_json()
    resena = (datos.get('resena') or '').strip() or None

    try:
        valor = int(datos.get('valor'))
    except (ValueError, TypeError):
        return jsonify({'error': 'La calificación es obligatoria'}), 400

    if valor not in (1, 2, 3):
        return jsonify({'error': 'La calificación debe ser de 1 a 3 estrellas'}), 400

    if resena and len(resena) > 200:
        return jsonify({'error': 'La reseña no puede superar los 200 caracteres'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT 1 FROM movimiento
            WHERE id_usuario = %s AND id_parqueadero = %s AND estado = 'retirado'
            LIMIT 1
        """, (id_usuario, id_parqueadero))
        if not cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'Solo puedes calificar parqueaderos donde ya hayas registrado una salida'}), 403

        cursor.execute("""
            SELECT id_tipo_calificacion FROM tipo_calificacion
            WHERE valor = %s AND estado = 'activo'
        """, (valor,))
        tipo = cursor.fetchone()
        if not tipo:
            cursor.close()
            db.close()
            return jsonify({'error': 'Escala de calificación inválida'}), 400

        cursor.execute("""
            SELECT id_calificacion FROM calificacion
            WHERE id_usuario = %s AND id_parqueadero = %s
        """, (id_usuario, id_parqueadero))
        existente = cursor.fetchone()

        if existente:
            cursor.execute("""
                UPDATE calificacion
                SET id_tipo_calificacion = %s, resena = %s, fecha_calificacion = CURRENT_TIMESTAMP
                WHERE id_calificacion = %s
            """, (tipo['id_tipo_calificacion'], resena, existente['id_calificacion']))
            codigo = 200
        else:
            cursor.execute("""
                INSERT INTO calificacion (id_usuario, id_parqueadero, id_tipo_calificacion, resena)
                VALUES (%s, %s, %s, %s)
            """, (id_usuario, id_parqueadero, tipo['id_tipo_calificacion'], resena))
            codigo = 201

        db.commit()
        cursor.close()
        db.close()

        return jsonify({'mensaje': 'Reseña guardada correctamente'}), codigo

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al guardar calificación: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

import secrets
import string
import requests
import os
import unicodedata
from datetime import datetime, time, timedelta, timezone

ZONA_COLOMBIA = timezone(timedelta(hours=-5))

DIAS_VALIDOS = {
    'lunes': 'Lunes',
    'martes': 'Martes',
    'miercoles': 'Miércoles',
    'jueves': 'Jueves',
    'viernes': 'Viernes',
    'sabado': 'Sábado',
    'domingo': 'Domingo'
}

def datetime_a_texto(valor):
    """
    Convierte un datetime devuelto por psycopg2 a un string ISO 8601
    SIN indicador de zona horaria (ej. '2026-08-23T13:26:00').

    PostgreSQL devuelve timestamptz como datetime con zona horaria (UTC).
    Se convierte a hora de Colombia (-05:00) antes de formatear, para que
    el navegador interprete correctamente la hora local al calcular
    duraciones o mostrar horarios de ingreso/salida.

    Recibe:
        - valor: datetime.datetime o None

    Retorna:
        str: fecha y hora en formato 'YYYY-MM-DDTHH:MM:SS'
        None: si el valor recibido es None
    """
    if valor is None:
        return None
    if isinstance(valor, datetime):
        if valor.tzinfo is not None:
            valor = valor.astimezone(ZONA_COLOMBIA)
        return valor.strftime('%Y-%m-%dT%H:%M:%S')
    return str(valor)

def normalizar_dia(valor):
    """
    Normaliza el nombre de un día recibido del frontend al valor
    exacto que espera el ENUM de la tabla horario, sin importar
    tildes, mayúsculas o espacios extra.

    Recibe:
        - valor: texto del día (ej. 'miercoles', 'Miércoles', ' SABADO ')

    Retorna:
        str: nombre del día en el formato del catálogo (ej. 'Miércoles')
        None: si el valor no coincide con ningún día válido
    """
    if not valor:
        return None

    # Descompone caracteres acentuados (é → e + tilde combinante) y
    # descarta las marcas diacríticas para comparar sin tildes
    sin_tildes = ''.join(
        c for c in unicodedata.normalize('NFD', valor.strip())
        if unicodedata.category(c) != 'Mn'
    ).lower()

    return DIAS_VALIDOS.get(sin_tildes)

def timedelta_a_hora(valor):
    """
    Convierte un valor TIME de la base de datos al formato 'HH:MM'
    que espera el frontend en los inputs type="time".

    PyMySQL devolvía datetime.timedelta; psycopg2 devuelve datetime.time.

    Recibe:
        - valor: datetime.timedelta, datetime.time o None

    Retorna:
        str: hora en formato 'HH:MM'
        None: si el valor recibido es None
    """
    if valor is None:
        return None

    if isinstance(valor, timedelta):
        total_segundos = int(valor.total_seconds())
        horas = total_segundos // 3600
        minutos = (total_segundos % 3600) // 60
        return f"{horas:02d}:{minutos:02d}"
    if isinstance(valor, time):
        return valor.strftime('%H:%M')
    if isinstance(valor, str):
        return valor[:5]
    return str(valor)

def generar_codigo_referencia(cursor):
    """
    Genera un código alfanumérico de 6 caracteres para el campo
    movimiento.codigo_referencia, verificando que no exista ya
    (la columna es UNIQUE).

    Excluye caracteres visualmente ambiguos (0/O, 1/I, 5/S, 8/B) para
    que el código sea fácil de leer y transcribir a mano, ya sea por
    el administrador en pantalla o por el conductor desde un SMS.

    Requiere:
        - cursor: cursor de base de datos activo

    Retorna:
        str: código de 6 caracteres, único en la tabla movimiento
    """
    caracteres = 'ACDEFGHJKLMNPQRTUVWXYZ234679'
    while True:
        codigo = ''.join(secrets.choice(caracteres) for _ in range(6))
        cursor.execute("SELECT 1 FROM movimiento WHERE codigo_referencia = %s", (codigo,))
        if not cursor.fetchone():
            return codigo

def enviar_sms(telefono, codigo_referencia):
    """
    Envía el código de referencia por SMS al conductor usando SMS
    Gateway for Android (modo local). Requiere que el celular con la
    app esté encendido y en la misma red que el servidor Flask.

    Requiere (variables de entorno en .flaskenv):
        - SMS_GATEWAY_URL: URL local de la app, ej. http://192.168.1.XX:8080
        - SMS_GATEWAY_USER: usuario generado por la app
        - SMS_GATEWAY_PASS: contraseña generada por la app

    Recibe:
        - telefono: número celular del conductor (10 dígitos)
        - codigo_referencia: código generado en el ingreso

    Retorna:
        bool: True si el gateway aceptó el mensaje, False si falló.
        No lanza excepción: un fallo de SMS no debe romper el registro
        del ingreso, que ya quedó guardado en la base de datos.
    """
    url = os.getenv('SMS_GATEWAY_URL')
    usuario = os.getenv('SMS_GATEWAY_USER')
    clave = os.getenv('SMS_GATEWAY_PASS')

    if not all([url, usuario, clave]):
        current_app.logger.warning('SMS Gateway no configurado; no se envió el SMS.')
        return False

    texto = f"Parqueate Cerca: tu codigo de salida es {codigo_referencia}"

    try:
        respuesta = requests.post(
            f"{url}/message",
            json={
                "textMessage": {"text": texto},
                "phoneNumbers": [f"+57{telefono}"]
            },
            auth=(usuario, clave),
            timeout=8
        )
        return respuesta.ok
    except requests.RequestException as e:
        current_app.logger.error(f"Error al enviar SMS: {e}")
        return False

@usuario_bp.route('/administrador/control-acceso')
@rol_administrador_requerido
def vista_control_acceso():
    """Renderiza la vista de ingresos y salidas (RF_14/RF_15). Pendiente de completar."""
    return render_template('administrador/control_acceso.html')

@usuario_bp.route('/api/control-acceso/buscar', methods=['GET'])
@rol_administrador_requerido
def api_control_acceso_buscar():
    """
    Determina qué acción corresponde a un valor ingresado por el
    administrador (RF_14 / RF_15). El buscador principal respeta
    estrictamente su propio texto: una placa siempre se interpreta
    como intento de ingreso, un código de referencia siempre se
    interpreta como intento de salida. La salida por placa (sin
    código) es un flujo aparte, disparado por el botón "¿No tiene el
    código?", no por este endpoint.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Recibe (query string):
        - valor: Placa o código de referencia ingresado

    Retorna (200):
        tipo "salida"          si el valor coincide con un código de
                                referencia de un movimiento activo
        tipo "ya_parqueado"    si el valor coincide con la placa de
                                un vehículo que ya tiene un ingreso
                                activo (evita duplicar el ingreso;
                                el admin debe usar la salida por placa)
        tipo "codigo_usado"    si el valor coincide con un código de
                                referencia ya existente pero de un
                                movimiento retirado
        tipo "ingreso_app"     si la placa pertenece a un vehículo
                                registrado por un conductor de la app
        tipo "ingreso_manual"  si la placa no está registrada en el
                                sistema
        tipo "no_encontrado"   si el valor no coincide con nada y es
                                demasiado largo para ser una placa
    """
    id_parqueadero = session.get('id_parqueadero')
    valor = request.args.get('valor', '').strip().upper()

    if not valor:
        return jsonify({'error': 'Debes indicar una placa o código'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Paso 1: ¿el valor es un CÓDIGO de un ticket activo? Ya no se
        # compara contra placa aquí; la salida por placa es un flujo
        # aparte, disparado por el botón dedicado.
        cursor.execute("""
            SELECT
                m.id_movimiento, m.origen, m.fecha_hora_entrada,
                COALESCE(v.placa, m.placa_manual) AS placa
            FROM movimiento m
            LEFT JOIN vehiculo v ON m.id_vehiculo = v.id_vehiculo
            WHERE m.id_parqueadero = %s
              AND m.estado = 'en_parqueadero'
              AND m.codigo_referencia = %s
            """, (id_parqueadero, valor))
        activo = cursor.fetchone()

        if activo:
            cursor.close()
            db.close()
            activo['fecha_hora_entrada'] = datetime_a_texto(activo['fecha_hora_entrada'])
            return jsonify({'tipo': 'salida', **activo}), 200

        # Paso 1.5: ¿el valor coincide con un código de referencia ya
        # existente (cualquier estado)? Es un código reciclado de un
        # movimiento retirado, no una placa nueva por registrar.
        cursor.execute("""
            SELECT estado FROM movimiento WHERE codigo_referencia = %s
            """, (valor,))
        codigo_existente = cursor.fetchone()

        if codigo_existente:
            cursor.close()
            db.close()
            return jsonify({'tipo': 'codigo_usado'}), 200

        # Paso 1.6: ¿el valor es la PLACA de un vehículo que ya tiene
        # un ingreso activo en este parqueadero? No lo tratamos como
        # ingreso nuevo (duplicaría el registro); se le pide al admin
        # usar el botón de salida por placa en su lugar.
        cursor.execute("""
            SELECT 1
            FROM movimiento m
            LEFT JOIN vehiculo v ON m.id_vehiculo = v.id_vehiculo
            WHERE m.id_parqueadero = %s
              AND m.estado = 'en_parqueadero'
              AND (v.placa = %s OR m.placa_manual = %s)
            """, (id_parqueadero, valor, valor))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'tipo': 'ya_parqueado'}), 200

        # Las placas en Colombia tienen máximo 6 caracteres
        if len(valor) > 6:
            cursor.close()
            db.close()
            return jsonify({'tipo': 'no_encontrado'}), 200

        # Paso 2: ¿la placa pertenece a un vehículo de un conductor
        # de la app?
        cursor.execute("""
            SELECT
                v.placa, v.id_tipo_vehiculo, tv.descripcion AS tipo_vehiculo,
                u.id_usuario, CONCAT(u.nombres, ' ', u.apellidos) AS nombre_conductor,
                u.telefono, u.correo
            FROM vehiculo v
            JOIN tipo_vehiculo tv ON v.id_tipo_vehiculo = tv.id_tipo_vehiculo
            JOIN usuario u ON v.id_usuario = u.id_usuario
            WHERE v.placa = %s AND v.estado = 'activo'
            """, (valor,))
        vehiculo = cursor.fetchone()
        cursor.close()
        db.close()

        if vehiculo:
            return jsonify({'tipo': 'ingreso_app', **vehiculo}), 200

        # Paso 3: no está en el sistema, se trata como ingreso manual
        return jsonify({'tipo': 'ingreso_manual', 'placa': valor}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error en búsqueda de control de acceso: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/control-acceso/ingreso', methods=['POST'])
@rol_administrador_requerido
def api_control_acceso_ingreso():
    """
    Registra el ingreso de un vehículo, generando su código de
    referencia y decrementando el cupo disponible (RF_13 / RF_14).
    Envía el código por SMS al número correspondiente: el del
    conductor de la app, o el capturado manualmente si el ingreso
    es de un vehículo no vinculado.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Recibe (JSON):
        - origen: 'app' o 'manual'
        - placa: Placa del vehículo
        - id_usuario: ID del conductor dueño (solo si origen = 'app')
        - id_tipo_vehiculo: ID de la categoría del vehículo
        - propietario_manual: Nombre del propietario (obligatorio si origen = 'manual')
        - telefono_manual: Teléfono a 10 dígitos (obligatorio si origen = 'manual')
        - correo_manual: Correo del propietario (obligatorio si origen = 'manual')

    Retorna:
        201: Ingreso registrado, con codigo_referencia generado
        400: Faltan campos obligatorios o el teléfono no es válido
        409: No hay cupo disponible para ese tipo de vehículo
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    datos = request.get_json()

    origen = datos.get('origen')
    placa = (datos.get('placa') or '').strip().upper()
    id_usuario_vehiculo = datos.get('id_usuario')
    id_tipo_vehiculo = datos.get('id_tipo_vehiculo')
    propietario_manual = (datos.get('propietario_manual') or '').strip() or None
    telefono_manual = (datos.get('telefono_manual') or '').strip() or None
    correo_manual = (datos.get('correo_manual') or '').strip().lower() or None

    if origen not in ('app', 'manual') or not placa or not id_tipo_vehiculo:
        return jsonify({'error': 'Faltan datos obligatorios para registrar el ingreso'}), 400

    if origen == 'app' and not id_usuario_vehiculo:
        return jsonify({'error': 'Falta el conductor vinculado al vehículo'}), 400

    # En el registro manual, nombre, teléfono y correo son obligatorios.
    # El teléfono se usa para enviar el código de salida por SMS.
    if origen == 'manual':
        if not propietario_manual:
            return jsonify({'error': 'El nombre del propietario es obligatorio'}), 400
        if not telefono_manual or not telefono_manual.isdigit() or len(telefono_manual) != 10:
            return jsonify({'error': 'El teléfono debe tener exactamente 10 dígitos numéricos'}), 400
        if not correo_manual or not _CORREO_RE.match(correo_manual):
            return jsonify({'error': 'El correo electrónico no es válido'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Decrementa el cupo de forma atómica: la condición
        # cupo_disponible > 0 evita que dos ingresos simultáneos dejen
        # el contador en negativo
        cursor.execute("""
            UPDATE cupo
            SET cupo_disponible = cupo_disponible - 1,
                cupo_ocupado = cupo_ocupado + 1
            WHERE id_parqueadero = %s
              AND id_tipo_vehiculo = %s
              AND cupo_disponible > 0
            """, (id_parqueadero, id_tipo_vehiculo))

        if cursor.rowcount == 0:
            cursor.close()
            db.close()
            return jsonify({'error': 'No hay cupo disponible para ese tipo de vehículo'}), 409

        codigo_referencia = generar_codigo_referencia(cursor)
        id_vehiculo = None
        id_usuario_movimiento = None
        telefono_conductor = None

        if origen == 'app':
            cursor.execute("SELECT id_vehiculo FROM vehiculo WHERE placa = %s", (placa,))
            vehiculo = cursor.fetchone()
            if not vehiculo:
                db.rollback()
                cursor.close()
                db.close()
                return jsonify({'error': 'El vehículo no está registrado en la app'}), 400

            cursor.execute("""
                SELECT CONCAT(nombres, ' ', apellidos) AS nombre, telefono, correo
                FROM usuario
                WHERE id_usuario = %s
                """, (id_usuario_vehiculo,))
            conductor = cursor.fetchone()
            if not conductor:
                db.rollback()
                cursor.close()
                db.close()
                return jsonify({'error': 'El conductor no está registrado'}), 400

            id_vehiculo = vehiculo['id_vehiculo']
            id_usuario_movimiento = id_usuario_vehiculo
            propietario_manual = conductor['nombre']
            telefono_manual = conductor['telefono']
            correo_manual = (conductor.get('correo') or '').strip().lower() or None
        else:
            # Ingreso de vehículo no vinculado: no hay vehiculo ni
            # usuario en el sistema; los datos los captura el admin.
            id_vehiculo = None
            id_usuario_movimiento = None

        # placa_manual, tipo, propietario, teléfono y correo se guardan
        # siempre (app y manual) como snapshot del ingreso. En origen
        # app se copian del conductor/vehículo; en manual vienen del
        # formulario. correo_manual requiere la columna en movimiento.
        cursor.execute("""
            INSERT INTO movimiento
                (id_parqueadero, id_vehiculo, id_usuario, codigo_referencia, origen,
                 placa_manual, id_tipo_vehiculo_manual, propietario_manual,
                 telefono_manual, correo_manual)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (id_parqueadero, id_vehiculo, id_usuario_movimiento,
                  codigo_referencia, origen, placa, id_tipo_vehiculo,
                  propietario_manual, telefono_manual, correo_manual))

        telefono_conductor = telefono_manual

        db.commit()
        cursor.close()
        db.close()

        # SMS y correo ocurren después de cerrar la conexión: un
        # fallo de envío no debe afectar el registro del ingreso.
        if telefono_conductor:
            enviar_sms(telefono_conductor, codigo_referencia)

        if correo_manual:
            enviar_correo(
                correo_manual,
                'Código de salida - Parquéate Cerca',
                f'Tu código de salida es: {codigo_referencia}\n'
                'Preséntalo en la barrera cuando retires el vehículo.'
            )

        return jsonify({
            'mensaje': 'Ingreso registrado correctamente',
            'codigo_referencia': codigo_referencia
        }), 201

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al registrar ingreso: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/control-acceso/salida', methods=['POST'])
@rol_administrador_requerido
def api_control_acceso_salida():
    """
    Registra la salida de un vehículo y libera el cupo correspondiente
    (RF_15).

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Recibe (JSON):
        - id_movimiento: ID del movimiento a cerrar

    Retorna:
        200: Salida registrada, cupo liberado
        400: Falta id_movimiento
        404: El movimiento no existe, no pertenece a este parqueadero,
             o ya fue cerrado
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    datos = request.get_json()
    id_movimiento = datos.get('id_movimiento')

    if not id_movimiento:
        return jsonify({'error': 'Falta el ID del movimiento'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Obtiene el tipo de vehículo del movimiento (de vehiculo si
        # es de la app, o de id_tipo_vehiculo_manual si es manual)
        # para saber a qué fila de cupo devolverle el espacio
        cursor.execute("""
            SELECT COALESCE(v.id_tipo_vehiculo, m.id_tipo_vehiculo_manual) AS id_tipo_vehiculo
            FROM movimiento m
            LEFT JOIN vehiculo v ON m.id_vehiculo = v.id_vehiculo
            WHERE m.id_movimiento = %s
              AND m.id_parqueadero = %s
              AND m.estado = 'en_parqueadero'
        """, (id_movimiento, id_parqueadero))
        movimiento = cursor.fetchone()

        if not movimiento:
            cursor.close()
            db.close()
            return jsonify({'error': 'El movimiento no existe o ya fue cerrado'}), 404

        cursor.execute("""
            UPDATE movimiento
            SET fecha_hora_salida = NOW(), estado = 'retirado'
            WHERE id_movimiento = %s
        """, (id_movimiento,))

        cursor.execute("""
            UPDATE cupo
            SET cupo_disponible = cupo_disponible + 1,
                cupo_ocupado = cupo_ocupado - 1
            WHERE id_parqueadero = %s AND id_tipo_vehiculo = %s
        """, (id_parqueadero, movimiento['id_tipo_vehiculo']))

        db.commit()
        cursor.close()
        db.close()

        return jsonify({'mensaje': 'Salida registrada correctamente'}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al registrar salida: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/control-acceso/salida/buscar-por-placa', methods=['GET'])
@rol_administrador_requerido
def api_control_acceso_buscar_por_placa():
    """
    Caso especial de RF_15: busca un movimiento activo por placa, sin
    depender del código de referencia, para cuando el conductor no lo
    tiene a la mano.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Recibe (query string):
        - placa: Placa del vehículo a buscar

    Retorna:
        200: Datos del movimiento activo
        400: Falta indicar la placa
        404: No hay ningún vehículo activo con esa placa en este parqueadero
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    placa = request.args.get('placa', '').strip().upper()

    if not placa:
        return jsonify({'error': 'Debes indicar una placa'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT
                m.id_movimiento, m.origen, m.fecha_hora_entrada,
                COALESCE(v.placa, m.placa_manual) AS placa
            FROM movimiento m
            LEFT JOIN vehiculo v ON m.id_vehiculo = v.id_vehiculo
            WHERE m.id_parqueadero = %s
              AND m.estado = 'en_parqueadero'
              AND (v.placa = %s OR m.placa_manual = %s)
        """, (id_parqueadero, placa, placa))
        movimiento = cursor.fetchone()
        cursor.close()
        db.close()

        if not movimiento:
            return jsonify({'error': 'No hay ningún vehículo activo con esa placa en tu parqueadero'}), 404

        # Mismo motivo que en api_control_acceso_buscar: jsonify()
        # etiquetaría este DATETIME naive como 'GMT' sin convertirlo,
        # haciendo que el navegador le reste 5 horas de más al
        # interpretarlo como UTC
        movimiento['fecha_hora_entrada'] = datetime_a_texto(movimiento['fecha_hora_entrada'])

        return jsonify(movimiento), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al buscar salida por placa: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/movimientos', methods=['GET'])
@rol_administrador_requerido
def api_movimientos():
    """
    Retorna el historial de movimientos (entradas y salidas) del
    parqueadero del administrador logueado, correspondiente a los
    últimos 30 días (RF_14 / RF_15). Incluye tanto vehículos de la app
    como registros manuales, mediante LEFT JOIN y COALESCE.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Retorna:
        200: Lista de movimientos con datos del vehículo y del conductor
        400: El administrador no tiene un parqueadero asociado
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    if not id_parqueadero:
        return jsonify({'error': 'El administrador no tiene un parqueadero asociado'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # LEFT JOIN en todas las tablas relacionadas al vehículo/usuario,
        # porque los registros manuales no tienen id_vehiculo ni
        # id_usuario. COALESCE combina el dato real (app) con el dato
        # manual guardado directamente en movimiento.
        cursor.execute("""
            SELECT
                m.codigo_referencia,
                COALESCE(v.placa, m.placa_manual) AS placa,
                COALESCE(tv.descripcion, tvm.descripcion) AS tipo_vehiculo,
                m.origen,
                m.fecha_hora_entrada,
                m.fecha_hora_salida,
                m.estado,
                CASE
                    WHEN u.id_usuario IS NOT NULL THEN CONCAT(u.nombres, ' ', u.apellidos)
                    WHEN m.propietario_manual IS NOT NULL THEN m.propietario_manual
                    ELSE 'No identificado'
                END AS conductor
            FROM movimiento m
            LEFT JOIN vehiculo v       ON m.id_vehiculo = v.id_vehiculo
            LEFT JOIN tipo_vehiculo tv ON v.id_tipo_vehiculo = tv.id_tipo_vehiculo
            LEFT JOIN tipo_vehiculo tvm ON m.id_tipo_vehiculo_manual = tvm.id_tipo_vehiculo
            LEFT JOIN usuario u        ON m.id_usuario = u.id_usuario
            WHERE m.id_parqueadero = %s
              AND m.fecha_hora_entrada >= NOW() - INTERVAL '30 days'
            ORDER BY m.fecha_hora_entrada DESC
            """, (id_parqueadero,))

        movimientos = cursor.fetchall()
        cursor.close()
        db.close()

        # Convierte las fechas antes de serializar: jsonify() por
        # defecto etiquetaría estos DATETIME naive como 'GMT' sin
        # convertirlos, haciendo que el navegador les reste 5 horas
        # de más al interpretarlos como UTC
        for mov in movimientos:
            mov['fecha_hora_entrada'] = datetime_a_texto(mov['fecha_hora_entrada'])
            mov['fecha_hora_salida'] = datetime_a_texto(mov['fecha_hora_salida'])

        return jsonify(movimientos), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al obtener movimientos: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/administrador/perfil')
@rol_administrador_requerido
def vista_perfil_parqueadero():
    """Renderiza el perfil del parqueadero. Pendiente de completar."""
    return render_template('administrador/perfil_parqueadero.html')

@usuario_bp.route('/conductor/mapa')
def vista_mapa():
    """
    Renderiza la vista del mapa interactivo del conductor.
    Redirige al login si no hay sesión activa.
    """
    if not session.get('id_usuario'):
        return redirect(url_for('auth.login'))
    return render_template('conductor/mapa.html')


@usuario_bp.route('/api/parqueaderos', methods=['GET'])
def api_parqueaderos():
    """
    Retorna los parqueaderos activos con sus coordenadas y cupos
    disponibles totales para el mapa interactivo (RF_18). Si el
    conductor tiene vehículos registrados, solo se devuelven los
    parqueaderos que acepten al menos uno de sus tipos de vehículo
    (cupo_total > 0 para ese tipo), para no mostrarle opciones donde
    nunca podría estacionar. Si el conductor no tiene ningún vehículo
    registrado, se devuelven todos los parqueaderos sin filtrar.

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Retorna:
        200: Lista de parqueaderos con coordenadas y cupos
        401: No hay sesión activa
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Tipos de vehículo que el conductor tiene registrados y activos
        cursor.execute("""
            SELECT DISTINCT id_tipo_vehiculo FROM vehiculo
            WHERE id_usuario = %s AND estado = 'activo'
        """, (id_usuario,))
        tipos_usuario = [row['id_tipo_vehiculo'] for row in cursor.fetchall()]

        if tipos_usuario:
            # Filtra: solo parqueaderos que tengan cupo_total > 0 para
            # AL MENOS uno de los tipos de vehículo del conductor
            formato_ids = ', '.join(['%s'] * len(tipos_usuario))
            cursor.execute(f"""
                SELECT
                    p.id_parqueadero,
                    p.nombre,
                    p.direccion,
                    p.latitud,
                    p.longitud,
                    COALESCE(SUM(c.cupo_disponible), 0) AS cupos_disponibles,
                    COALESCE(SUM(c.cupo_total), 0)      AS cupos_total
                FROM parqueadero p
                LEFT JOIN cupo c ON p.id_parqueadero = c.id_parqueadero
                WHERE p.estado = 'activo'
                  AND EXISTS (
                        SELECT 1 FROM cupo c2
                        WHERE c2.id_parqueadero = p.id_parqueadero
                          AND c2.id_tipo_vehiculo IN ({formato_ids})
                          AND c2.cupo_total > 0
                  )
                GROUP BY p.id_parqueadero, p.nombre, p.direccion, p.latitud, p.longitud
                ORDER BY p.nombre
            """, tuple(tipos_usuario))
        else:
            # El conductor no tiene vehículos registrados: no hay nada
            # contra qué filtrar, se muestran todos los parqueaderos
            cursor.execute("""
                SELECT
                    p.id_parqueadero,
                    p.nombre,
                    p.direccion,
                    p.latitud,
                    p.longitud,
                    COALESCE(SUM(c.cupo_disponible), 0) AS cupos_disponibles,
                    COALESCE(SUM(c.cupo_total), 0)      AS cupos_total
                FROM parqueadero p
                LEFT JOIN cupo c ON p.id_parqueadero = c.id_parqueadero
                WHERE p.estado = 'activo'
                GROUP BY p.id_parqueadero, p.nombre, p.direccion, p.latitud, p.longitud
                ORDER BY p.nombre
            """)

        parqueaderos = cursor.fetchall()
        cursor.close()
        db.close()
        return jsonify(parqueaderos), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al obtener parqueaderos: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/parqueadero/registrar', methods=['POST'])
def api_registrar_parqueadero():
    """
    Registra un nuevo parqueadero y asigna el rol Administrador
    al conductor que lo registra (RF_10, RF_05). Inicializa en 0
    el cupo de cada tipo de vehículo (RF_13), para que el
    administrador solo tenga que actualizarlos después desde su
    perfil, en vez de crearlos.

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Recibe (JSON):
        - nit: NIT del establecimiento (opcional)
        - nombre: Nombre del parqueadero
        - direccion: Dirección física
        - correo: Correo de contacto del parqueadero
        - telefono: Teléfono de contacto
        - capacidad_total: Número total de espacios
        - latitud: Coordenada geográfica
        - longitud: Coordenada geográfica

    Retorna:
        201: Parqueadero registrado, perfil Administrador asignado
        400: Campos obligatorios vacíos o datos duplicados
        401: No hay sesión activa
        409: El usuario ya tiene un parqueadero registrado
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    datos = request.get_json()
    nit          = (datos.get('nit') or '').strip() or None
    nombre       = datos.get('nombre', '').strip()
    direccion    = datos.get('direccion', '').strip()
    correo       = datos.get('correo', '').strip()
    telefono     = datos.get('telefono', '').strip()
    capacidad    = datos.get('capacidad_total')
    latitud      = datos.get('latitud')
    longitud     = datos.get('longitud')

    if not all([nombre, direccion, correo, telefono, capacidad, latitud, longitud]):
        return jsonify({'error': 'Todos los campos obligatorios deben completarse'}), 400

    try:
        capacidad = int(capacidad)
        latitud   = float(latitud)
        longitud  = float(longitud)
    except (ValueError, TypeError):
        return jsonify({'error': 'Capacidad, latitud y longitud deben ser valores numéricos'}), 400

    if capacidad < 1:
        return jsonify({'error': 'La capacidad total debe ser mayor a cero'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Verifica que el usuario no tenga ya un parqueadero activo
        cursor.execute("""
            SELECT id_parqueadero FROM parqueadero
            WHERE id_usuario = %s AND estado = 'activo'
        """, (id_usuario,))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'Ya tienes un parqueadero registrado'}), 409

        # Verifica unicidad de correo
        cursor.execute("""
            SELECT id_parqueadero FROM parqueadero WHERE correo = %s
        """, (correo,))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El correo ya está registrado en otro parqueadero'}), 400

        # Verifica unicidad de teléfono
        cursor.execute("""
            SELECT id_parqueadero FROM parqueadero WHERE telefono = %s
        """, (telefono,))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El teléfono ya está registrado en otro parqueadero'}), 400

        # Inserta el parqueadero. La descripción se completa después
        # desde administrador/perfil, por eso no se pide en este paso
        cursor.execute("""
            INSERT INTO parqueadero
                (id_usuario, nit, nombre, direccion, correo, telefono,
                 capacidad_total, latitud, longitud)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id_parqueadero
        """, (id_usuario, nit, nombre, direccion, correo, telefono,
              capacidad, latitud, longitud))

        id_parqueadero = cursor.fetchone()['id_parqueadero']

        # RF_13: crea la fila de cupo en 0 para cada tipo de vehículo
        # activo del catálogo. Sin esto, cupo queda sin filas para este
        # parqueadero y cualquier intento de ingreso de vehículo falla
        # con "No hay cupo disponible" aunque el admin nunca haya tenido
        # la oportunidad de configurarlo.
        cursor.execute("""
            SELECT id_tipo_vehiculo FROM tipo_vehiculo WHERE estado = 'activo'
        """)
        tipos_vehiculo = cursor.fetchall()
        for tipo in tipos_vehiculo:
            cursor.execute("""
                INSERT INTO cupo (id_parqueadero, id_tipo_vehiculo, cupo_total, cupo_disponible, cupo_ocupado)
                VALUES (%s, %s, 0, 0, 0)
            """, (id_parqueadero, tipo['id_tipo_vehiculo']))

        # RF_05: asigna el rol Administrador en usuario_perfil
        cursor.execute("""
            INSERT INTO usuario_perfil (id_usuario, id_tipo_perfil)
            SELECT %s, 2
            WHERE NOT EXISTS (
                SELECT 1 FROM usuario_perfil
                WHERE id_usuario = %s AND id_tipo_perfil = 2
            )
        """, (id_usuario, id_usuario))

        # RF_05: actualiza el perfil activo a Administrador
        cursor.execute("""
            UPDATE usuario SET id_perfil_activo = 2
            WHERE id_usuario = %s
        """, (id_usuario,))

        db.commit()
        cursor.close()
        db.close()

        # Actualiza la sesión: perfil Administrador y su parqueadero,
        # para que las vistas de administrador funcionen sin necesidad
        # de un nuevo login
        session['perfil'] = 'Administrador'
        session['id_parqueadero'] = id_parqueadero

        return jsonify({
            'mensaje': 'Parqueadero registrado correctamente',
            'redirigir': '/administrador/perfil'
        }), 201

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al registrar parqueadero: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/parqueadero/perfil', methods=['GET'])
@rol_administrador_requerido
def api_parqueadero_perfil():
    """
    Retorna toda la información del parqueadero del administrador
    logueado para poblar administrador/perfil: datos básicos,
    descripción, ubicación, fotos, cupos por tipo de vehículo,
    servicios activos con su horario propio (si tiene) y el
    horario general del parqueadero.

    Las columnas TIME de horario llegan desde PyMySQL como
    datetime.timedelta, no como texto; se convierten con
    timedelta_a_hora() antes de serializar, porque jsonify() no
    sabe convertir timedelta a JSON.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Retorna:
        200: Objeto con todos los datos del parqueadero
        400: El administrador no tiene un parqueadero asociado
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    if not id_parqueadero:
        return jsonify({'error': 'El administrador no tiene un parqueadero asociado'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT id_parqueadero, nit, nombre, direccion, descripcion,
                   correo, telefono, capacidad_total, latitud, longitud
            FROM parqueadero
            WHERE id_parqueadero = %s
        """, (id_parqueadero,))
        parqueadero = cursor.fetchone()

        cursor.execute("""
            SELECT id_imagen, ruta_archivo, orden
            FROM imagen_parqueadero
            WHERE id_parqueadero = %s
            ORDER BY orden
        """, (id_parqueadero,))
        fotos = cursor.fetchall()

        # Cupos: LEFT JOIN desde tipo_vehiculo para que siempre salgan
        # los 5 tipos aunque el registro de cupo tenga todo en 0
        cursor.execute("""
            SELECT tv.id_tipo_vehiculo, tv.descripcion,
                   COALESCE(c.cupo_total, 0) AS cupo_total,
                   COALESCE(c.cupo_disponible, 0) AS cupo_disponible,
                   COALESCE(c.cupo_ocupado, 0) AS cupo_ocupado
            FROM tipo_vehiculo tv
            LEFT JOIN cupo c
                ON c.id_tipo_vehiculo = tv.id_tipo_vehiculo
                AND c.id_parqueadero = %s
            WHERE tv.estado = 'activo'
            ORDER BY tv.id_tipo_vehiculo
        """, (id_parqueadero,))
        cupos = cursor.fetchall()

        # Servicios activos de este parqueadero, con su horario propio
        # si lo tiene (LEFT JOIN a horario por id_parqueadero_servicio)
        cursor.execute("""
            SELECT ps.id_parqueadero_servicio, ts.id_tipo_servicio, ts.descripcion,
                   h.dia_inicial, h.dia_final, h.hora_inicial, h.hora_final
            FROM parqueadero_servicio ps
            JOIN tipo_servicio ts ON ps.id_tipo_servicio = ts.id_tipo_servicio
            LEFT JOIN horario h ON h.id_parqueadero_servicio = ps.id_parqueadero_servicio
            WHERE ps.id_parqueadero = %s
        """, (id_parqueadero,))
        servicios = cursor.fetchall()

        # Convierte las horas TIME (timedelta) de cada servicio a texto
        for servicio in servicios:
            servicio['hora_inicial'] = timedelta_a_hora(servicio['hora_inicial'])
            servicio['hora_final'] = timedelta_a_hora(servicio['hora_final'])

        # Horario general del parqueadero (id_parqueadero_servicio IS NULL
        # lo distingue de los horarios propios de cada servicio)
        cursor.execute("""
            SELECT dia_inicial, dia_final, hora_inicial, hora_final
            FROM horario
            WHERE id_parqueadero = %s AND id_parqueadero_servicio IS NULL
        """, (id_parqueadero,))
        horario_general = cursor.fetchone()

        # Convierte las horas TIME (timedelta) del horario general a texto
        if horario_general:
            horario_general['hora_inicial'] = timedelta_a_hora(horario_general['hora_inicial'])
            horario_general['hora_final'] = timedelta_a_hora(horario_general['hora_final'])

        cursor.close()
        db.close()

        parqueadero['fotos'] = fotos
        parqueadero['cupos'] = cupos
        parqueadero['servicios'] = servicios
        parqueadero['horario_general'] = horario_general

        return jsonify(parqueadero), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al obtener perfil del parqueadero: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/parqueadero/datos', methods=['PUT'])
@rol_administrador_requerido
def api_parqueadero_actualizar_datos():
    """
    Actualiza los datos básicos del parqueadero: nombre, dirección,
    descripción, correo, teléfono y opcionalmente su ubicación
    (RF_10). El NIT y la capacidad total no se modifican aquí porque
    no fueron solicitados como editables en este formulario.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Recibe (JSON):
        - nombre, direccion, correo, telefono: obligatorios
        - descripcion: opcional, máximo 500 caracteres
        - latitud, longitud: opcionales, solo si el admin reposicionó el mapa

    Retorna:
        200: Datos actualizados correctamente
        400: Campos obligatorios vacíos o datos duplicados
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    datos = request.get_json()

    nombre      = datos.get('nombre', '').strip()
    direccion   = datos.get('direccion', '').strip()
    correo      = datos.get('correo', '').strip()
    telefono    = datos.get('telefono', '').strip()
    descripcion = (datos.get('descripcion') or '').strip() or None
    latitud     = datos.get('latitud')
    longitud    = datos.get('longitud')

    if not all([nombre, direccion, correo, telefono]):
        return jsonify({'error': 'Nombre, dirección, correo y teléfono son obligatorios'}), 400

    if descripcion and len(descripcion) > 500:
        return jsonify({'error': 'La descripción no puede superar los 500 caracteres'}), 400

    if latitud is not None and longitud is not None:
        try:
            latitud = float(latitud)
            longitud = float(longitud)
        except (ValueError, TypeError):
            return jsonify({'error': 'Latitud y longitud deben ser valores numéricos'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Unicidad de correo, excluyendo este mismo parqueadero
        cursor.execute("""
            SELECT id_parqueadero FROM parqueadero
            WHERE correo = %s AND id_parqueadero != %s
        """, (correo, id_parqueadero))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El correo ya está registrado en otro parqueadero'}), 400

        # Unicidad de teléfono, excluyendo este mismo parqueadero
        cursor.execute("""
            SELECT id_parqueadero FROM parqueadero
            WHERE telefono = %s AND id_parqueadero != %s
        """, (telefono, id_parqueadero))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El teléfono ya está registrado en otro parqueadero'}), 400

        if latitud is not None and longitud is not None:
            cursor.execute("""
                UPDATE parqueadero
                SET nombre = %s, direccion = %s, descripcion = %s,
                    correo = %s, telefono = %s, latitud = %s, longitud = %s
                WHERE id_parqueadero = %s
            """, (nombre, direccion, descripcion, correo, telefono,
                  latitud, longitud, id_parqueadero))
        else:
            cursor.execute("""
                UPDATE parqueadero
                SET nombre = %s, direccion = %s, descripcion = %s,
                    correo = %s, telefono = %s
                WHERE id_parqueadero = %s
            """, (nombre, direccion, descripcion, correo, telefono, id_parqueadero))

        db.commit()
        cursor.close()
        db.close()

        return jsonify({'mensaje': 'Datos actualizados correctamente'}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al actualizar datos del parqueadero: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/servicios/tipos', methods=['GET'])
def api_tipos_servicio():
    """
    Retorna el catálogo de servicios adicionales activos (RF_12),
    para que el frontend pinte los checkboxes dinámicamente en vez
    de tenerlos escritos manualmente en el HTML.

    Retorna:
        200: Lista de tipos de servicio activos
        500: Error de base de datos
    """
    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT id_tipo_servicio, descripcion
            FROM tipo_servicio
            WHERE estado = 'activo'
            ORDER BY id_tipo_servicio
        """)
        tipos = cursor.fetchall()
        cursor.close()
        db.close()

        return jsonify(tipos), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al obtener catálogo de servicios: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/parqueadero/cupos', methods=['PUT'])
@rol_administrador_requerido
def api_parqueadero_actualizar_cupos():
    """
    Actualiza el cupo_total por tipo de vehículo del parqueadero
    (RF_13). Puede dejar tipos en 0 si no aplican. La suma de todos
    los cupo_total no puede superar capacidad_total, y ningún
    cupo_total puede quedar por debajo de los espacios que ya están
    ocupados en este momento.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Recibe (JSON):
        - cupos: lista de objetos {id_tipo_vehiculo, cupo_total}

    Retorna:
        200: Cupos actualizados correctamente
        400: Datos inválidos, suma mayor a capacidad_total, o
             cupo_total menor al cupo_ocupado actual
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    datos = request.get_json()
    cupos_nuevos = datos.get('cupos')
    capacidad_total_nueva = datos.get('capacidad_total')
    if capacidad_total_nueva is not None:
        try:
            capacidad_total_nueva = int(capacidad_total_nueva)
        except (ValueError, TypeError):
            return jsonify({'error': 'La capacidad total debe ser un valor numérico'}), 400
        if capacidad_total_nueva < 0:
            return jsonify({'error': 'La capacidad total no puede ser negativa'}), 400

    if not isinstance(cupos_nuevos, list) or not cupos_nuevos:
        return jsonify({'error': 'Debes enviar la lista de cupos por tipo de vehículo'}), 400

    try:
        cupos_nuevos = [
            {'id_tipo_vehiculo': int(c['id_tipo_vehiculo']), 'cupo_total': int(c['cupo_total'])}
            for c in cupos_nuevos
        ]
    except (KeyError, ValueError, TypeError):
        return jsonify({'error': 'Cada cupo debe incluir id_tipo_vehiculo y cupo_total numéricos'}), 400

    if any(c['cupo_total'] < 0 for c in cupos_nuevos):
        return jsonify({'error': 'Ningún cupo puede ser negativo'}), 400

    suma_nueva = sum(c['cupo_total'] for c in cupos_nuevos)

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT capacidad_total FROM parqueadero WHERE id_parqueadero = %s
        """, (id_parqueadero,))
        parqueadero = cursor.fetchone()

        capacidad_referencia = capacidad_total_nueva if capacidad_total_nueva is not None else parqueadero['capacidad_total']

        if suma_nueva > capacidad_referencia:
            cursor.close()
            db.close()
            return jsonify({
                'error': f"La suma de cupos ({suma_nueva}) no puede superar la capacidad total ({capacidad_referencia})"
            }), 400

        # Verifica que ningún cupo_total nuevo quede por debajo de lo
        # que ya está ocupado en este momento
        cursor.execute("""
            SELECT id_tipo_vehiculo, cupo_ocupado FROM cupo
            WHERE id_parqueadero = %s
        """, (id_parqueadero,))
        ocupados_actuales = {row['id_tipo_vehiculo']: row['cupo_ocupado'] for row in cursor.fetchall()}

        for cupo in cupos_nuevos:
            ocupado = ocupados_actuales.get(cupo['id_tipo_vehiculo'], 0)
            if cupo['cupo_total'] < ocupado:
                cursor.close()
                db.close()
                return jsonify({
                    'error': f"No puedes bajar el cupo de ese tipo de vehículo por debajo de los {ocupado} espacios ya ocupados"
                }), 400

        # Actualiza cada tipo: cupo_disponible se recalcula para
        # mantener la coherencia con chk_cupo_coherencia
        for cupo in cupos_nuevos:
            ocupado = ocupados_actuales.get(cupo['id_tipo_vehiculo'], 0)
            cursor.execute("""
                UPDATE cupo
                SET cupo_total = %s, cupo_disponible = %s
                WHERE id_parqueadero = %s AND id_tipo_vehiculo = %s
            """, (cupo['cupo_total'], cupo['cupo_total'] - ocupado,
                  id_parqueadero, cupo['id_tipo_vehiculo']))

        if capacidad_total_nueva is not None:
            cursor.execute("""
                UPDATE parqueadero SET capacidad_total = %s WHERE id_parqueadero = %s
            """, (capacidad_total_nueva, id_parqueadero))

        db.commit()
        cursor.close()
        db.close()

        return jsonify({'mensaje': 'Cupos actualizados correctamente'}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al actualizar cupos: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/parqueadero/horario-general', methods=['PUT'])
@rol_administrador_requerido
def api_parqueadero_horario_general():
    """
    Define o actualiza el horario general de operación del
    parqueadero (RF_11). Es obligatorio y único: se identifica por
    id_parqueadero_servicio IS NULL. Reemplaza el horario anterior
    si ya existía (borra e inserta) en vez de acumular filas.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Recibe (JSON):
        - dia_inicial, dia_final: nombres de día, con o sin tildes
        - hora_inicial, hora_final: formato HH:MM

    Retorna:
        200: Horario guardado correctamente
        400: Campos obligatorios vacíos o día no reconocido
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    datos = request.get_json()

    dia_inicial  = normalizar_dia(datos.get('dia_inicial'))
    dia_final    = normalizar_dia(datos.get('dia_final'))
    hora_inicial = datos.get('hora_inicial')
    hora_final   = datos.get('hora_final')

    if not all([dia_inicial, dia_final, hora_inicial, hora_final]):
        return jsonify({'error': 'Todos los campos del horario son obligatorios, y los días deben ser válidos'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            DELETE FROM horario
            WHERE id_parqueadero = %s AND id_parqueadero_servicio IS NULL
        """, (id_parqueadero,))

        cursor.execute("""
            INSERT INTO horario (id_parqueadero, dia_inicial, dia_final, hora_inicial, hora_final)
            VALUES (%s, %s, %s, %s, %s)
        """, (id_parqueadero, dia_inicial, dia_final, hora_inicial, hora_final))

        db.commit()
        cursor.close()
        db.close()

        return jsonify({'mensaje': 'Horario general guardado correctamente'}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al guardar horario general: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/parqueadero/servicios', methods=['PUT'])
@rol_administrador_requerido
def api_parqueadero_actualizar_servicios():
    """
    Sincroniza los servicios adicionales activos del parqueadero
    (RF_12) y, opcionalmente, el horario propio de cada uno (RF_11).
    Si un servicio no trae horario propio en el payload, hereda el
    horario general del parqueadero (no se crea fila en horario
    para ese caso).

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Recibe (JSON):
        - servicios: lista de objetos:
            {
              id_tipo_servicio: int,
              horario_propio: {dia_inicial, dia_final, hora_inicial, hora_final} | null
            }
          Los días de horario_propio pueden venir con o sin tildes.

    Retorna:
        200: Servicios actualizados correctamente
        400: Datos inválidos, o día no reconocido en algún horario_propio
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')
    datos = request.get_json()
    servicios_nuevos = datos.get('servicios')

    if not isinstance(servicios_nuevos, list):
        return jsonify({'error': 'Debes enviar la lista de servicios'}), 400

    # Valida y normaliza los días de cada horario_propio antes de
    # tocar la base de datos, para no dejar cambios a medias si uno
    # de los servicios trae un día inválido
    for servicio in servicios_nuevos:
        horario_propio = servicio.get('horario_propio')
        if horario_propio:
            dia_inicial = normalizar_dia(horario_propio.get('dia_inicial'))
            dia_final = normalizar_dia(horario_propio.get('dia_final'))
            if not dia_inicial or not dia_final or not horario_propio.get('hora_inicial') or not horario_propio.get('hora_final'):
                return jsonify({'error': 'El horario propio de un servicio tiene campos inválidos o incompletos'}), 400
            horario_propio['dia_inicial'] = dia_inicial
            horario_propio['dia_final'] = dia_final

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Servicios que el parqueadero tiene activos actualmente
        cursor.execute("""
            SELECT id_parqueadero_servicio, id_tipo_servicio
            FROM parqueadero_servicio
            WHERE id_parqueadero = %s
        """, (id_parqueadero,))
        servicios_actuales = cursor.fetchall()
        ids_actuales = {s['id_tipo_servicio']: s['id_parqueadero_servicio'] for s in servicios_actuales}
        ids_nuevos = {s['id_tipo_servicio'] for s in servicios_nuevos}

        # Servicios que se quitaron: borra primero su horario propio
        # (si tenía) y luego la fila de parqueadero_servicio, porque
        # horario.id_parqueadero_servicio no tiene ON DELETE CASCADE
        for id_tipo, id_ps in ids_actuales.items():
            if id_tipo not in ids_nuevos:
                cursor.execute("DELETE FROM horario WHERE id_parqueadero_servicio = %s", (id_ps,))
                cursor.execute("DELETE FROM parqueadero_servicio WHERE id_parqueadero_servicio = %s", (id_ps,))

        # Servicios que siguen o se agregan: inserta si es nuevo,
        # y siempre reemplaza su horario propio (borra e inserta)
        for servicio in servicios_nuevos:
            id_tipo_servicio = servicio.get('id_tipo_servicio')
            horario_propio = servicio.get('horario_propio')

            if id_tipo_servicio in ids_actuales:
                id_ps = ids_actuales[id_tipo_servicio]
            else:
                cursor.execute("""
                    INSERT INTO parqueadero_servicio (id_parqueadero, id_tipo_servicio)
                    VALUES (%s, %s)
                    RETURNING id_parqueadero_servicio
                """, (id_parqueadero, id_tipo_servicio))
                id_ps = cursor.fetchone()['id_parqueadero_servicio']

            cursor.execute("DELETE FROM horario WHERE id_parqueadero_servicio = %s", (id_ps,))

            if horario_propio:
                cursor.execute("""
                    INSERT INTO horario
                        (id_parqueadero_servicio, dia_inicial, dia_final, hora_inicial, hora_final)
                    VALUES (%s, %s, %s, %s, %s)
                """, (id_ps, horario_propio['dia_inicial'], horario_propio['dia_final'],
                      horario_propio['hora_inicial'], horario_propio['hora_final']))

        db.commit()
        cursor.close()
        db.close()

        return jsonify({'mensaje': 'Servicios actualizados correctamente'}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al actualizar servicios: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

import os
from werkzeug.utils import secure_filename

EXTENSIONES_PERMITIDAS = {'jpg', 'jpeg', 'png'}


@usuario_bp.route('/api/parqueadero/fotos', methods=['POST'])
@rol_administrador_requerido
def api_parqueadero_subir_foto():
    """
    Sube una imagen del parqueadero (RF_10). Máximo 6 imágenes por
    parqueadero, reforzado también por trg_limite_imagenes en la
    base de datos. Solo acepta jpg/jpeg/png porque la columna
    imagen_parqueadero.formato es ENUM('jpg', 'png').

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto
        - Archivo enviado como multipart/form-data en el campo 'imagen'

    Retorna:
        201: Imagen guardada, con su id y ruta
        400: Archivo faltante o formato no permitido
        409: Ya se alcanzó el máximo de 6 imágenes
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')

    if 'imagen' not in request.files:
        return jsonify({'error': 'No se envió ningún archivo'}), 400

    archivo = request.files['imagen']
    if archivo.filename == '':
        return jsonify({'error': 'No se envió ningún archivo'}), 400

    extension = archivo.filename.rsplit('.', 1)[-1].lower() if '.' in archivo.filename else ''
    if extension not in EXTENSIONES_PERMITIDAS:
        return jsonify({'error': 'Solo se permiten imágenes JPG o PNG'}), 400

    formato = 'jpg' if extension in ('jpg', 'jpeg') else 'png'

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT COUNT(*) AS total, COALESCE(MAX(orden), 0) AS max_orden
            FROM imagen_parqueadero
            WHERE id_parqueadero = %s
        """, (id_parqueadero,))
        conteo = cursor.fetchone()

        if conteo['total'] >= 6:
            cursor.close()
            db.close()
            return jsonify({'error': 'Ya alcanzaste el máximo de 6 imágenes'}), 409

        nuevo_orden = conteo['max_orden'] + 1

        # Guarda el archivo con un nombre único para evitar colisiones
        # entre parqueaderos distintos con el mismo nombre de archivo original
        carpeta = os.path.join(current_app.root_path, 'static', 'uploads', 'parqueaderos', str(id_parqueadero))
        os.makedirs(carpeta, exist_ok=True)

        nombre_archivo = f"{secure_filename(archivo.filename.rsplit('.', 1)[0])}_{nuevo_orden}.{extension}"
        ruta_absoluta = os.path.join(carpeta, nombre_archivo)
        archivo.save(ruta_absoluta)

        ruta_relativa = f"uploads/parqueaderos/{id_parqueadero}/{nombre_archivo}"

        cursor.execute("""
            INSERT INTO imagen_parqueadero (id_parqueadero, ruta_archivo, formato, orden)
            VALUES (%s, %s, %s, %s)
            RETURNING id_imagen
        """, (id_parqueadero, ruta_relativa, formato, nuevo_orden))

        db.commit()
        id_imagen = cursor.fetchone()['id_imagen']
        cursor.close()
        db.close()

        return jsonify({
            'mensaje': 'Imagen guardada correctamente',
            'id_imagen': id_imagen,
            'ruta_archivo': ruta_relativa,
            'orden': nuevo_orden
        }), 201

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al guardar imagen: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/parqueadero/fotos/<int:id_imagen>', methods=['DELETE'])
@rol_administrador_requerido
def api_parqueadero_eliminar_foto(id_imagen):
    """
    Elimina una imagen del parqueadero, tanto el registro en base
    de datos como el archivo físico en disco.

    Requiere:
        - Sesión activa con perfil Administrador
        - session['id_parqueadero'] resuelto

    Retorna:
        200: Imagen eliminada correctamente
        404: La imagen no existe o no pertenece a este parqueadero
        500: Error de base de datos
    """
    id_parqueadero = session.get('id_parqueadero')

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT ruta_archivo FROM imagen_parqueadero
            WHERE id_imagen = %s AND id_parqueadero = %s
        """, (id_imagen, id_parqueadero))
        imagen = cursor.fetchone()

        if not imagen:
            cursor.close()
            db.close()
            return jsonify({'error': 'La imagen no existe o no pertenece a tu parqueadero'}), 404

        cursor.execute("DELETE FROM imagen_parqueadero WHERE id_imagen = %s", (id_imagen,))
        db.commit()
        cursor.close()
        db.close()

        # Borra el archivo físico después de confirmar el borrado en BD.
        # No se lanza error si el archivo ya no existe en disco.
        ruta_absoluta = os.path.join(current_app.root_path, 'static', imagen['ruta_archivo'])
        if os.path.exists(ruta_absoluta):
            os.remove(ruta_absoluta)

        return jsonify({'mensaje': 'Imagen eliminada correctamente'}), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al eliminar imagen: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500

# —— API de usuario ————————————————————————————————————————————————————————————

@usuario_bp.route('/api/usuario/perfil', methods=['GET'])
def api_perfil():
    """
    Retorna los datos del usuario actualmente logueado, incluyendo
    el id de su parqueadero si ya registró uno (o null si no).
    El frontend usa id_parqueadero para decidir si el botón de la
    navbar debe llevar al registro o directo al panel de administrador.

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Retorna:
        200: Datos del usuario
        401: No hay sesión activa
        404: Usuario no encontrado
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT u.id_usuario, u.nombres, u.apellidos, u.correo, u.telefono,
                u.numero_documento, u.estado, u.fecha_registro,
                td.descripcion AS tipo_documento,
                tp.descripcion AS perfil
            FROM usuario u
            JOIN tipo_documento td ON u.id_tipo_documento = td.id_tipo_documento
            JOIN tipo_perfil tp ON u.id_perfil_activo = tp.id_tipo_perfil
            WHERE u.id_usuario = %s AND u.estado = 'activo'
        """, (id_usuario,))
        usuario = cursor.fetchone()

        # Indica si este usuario ya tiene un parqueadero registrado,
        # sin importar cuál sea su perfil activo en este momento
        cursor.execute("""
            SELECT id_parqueadero FROM parqueadero
            WHERE id_usuario = %s AND estado = 'activo'
        """, (id_usuario,))
        parqueadero = cursor.fetchone()

        cursor.close()
        db.close()

        if not usuario:
            return jsonify({'error': 'Usuario no encontrado'}), 404

        usuario['id_parqueadero'] = parqueadero['id_parqueadero'] if parqueadero else None

        return jsonify(usuario), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al obtener perfil: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/usuario/modificar', methods=['PUT'])
def api_modificar():
    """
    Modifica los datos del usuario logueado.
    Solo permite cambiar nombres, apellidos, correo y teléfono.

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Recibe (JSON):
        - nombres: Nuevos nombres
        - apellidos: Nuevos apellidos
        - correo: Nuevo correo electrónico
        - telefono: Nuevo teléfono

    Retorna:
        200: Datos actualizados correctamente
        400: Campos vacíos, correo o teléfono ya registrado
        401: No hay sesión activa
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    datos = request.get_json()
    nombres = datos.get('nombres')
    apellidos = datos.get('apellidos')
    correo = datos.get('correo')
    telefono = datos.get('telefono')

    # Verifica que ningún campo esté vacío
    if not all([nombres, apellidos, correo, telefono]):
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Verifica que el nuevo correo no esté registrado por otro usuario
        cursor.execute("""
            SELECT id_usuario FROM usuario 
            WHERE correo = %s AND id_usuario != %s 
        """, (correo, id_usuario))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El correo ya está registrado por otro usuario'}), 400

        # Verifica que el nuevo teléfono no esté registrado por otro usuario
        cursor.execute("""
            SELECT id_usuario FROM usuario
            WHERE telefono = %s AND id_usuario != %s
        """, (telefono, id_usuario))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'El teléfono ya está registrado por otro usuario'}), 400

        # Actualiza los datos del usuario
        cursor.execute("""
            UPDATE usuario SET nombres = %s, apellidos = %s, correo = %s, telefono = %s
            WHERE id_usuario = %s
        """, (nombres, apellidos, correo, telefono, id_usuario))

        db.commit()
        cursor.close()
        db.close()

        # Actualiza el nombre en la sesión
        session['nombres'] = nombres

        return jsonify({'mensaje': 'Datos actualizados correctamente'}), 200

    except psycopg2.Error as e:
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/usuario/cambiar-contrasena', methods=['PUT'])
def api_cambiar_contrasena():
    """
    Cambia la contraseña del usuario logueado desde su perfil.
    Requiere verificar la contraseña actual antes de cambiarla.

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Recibe (JSON):
        - contrasena_actual: Contraseña actual del usuario
        - contrasena_nueva: Nueva contraseña
        - confirmar: Confirmación de la nueva contraseña

    Retorna:
        200: Contraseña cambiada correctamente
        400: Campos vacíos, contraseñas no coinciden o actual incorrecta
        401: No hay sesión activa
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    datos = request.get_json()
    contrasena_actual = datos.get('contrasena_actual')
    contrasena_nueva = datos.get('contrasena_nueva')
    confirmar = datos.get('confirmar')

    if not all([contrasena_actual, contrasena_nueva, confirmar]):
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400

    # Verifica que la nueva contraseña y la confirmación coincidan
    if contrasena_nueva != confirmar:
        return jsonify({'error': 'Las contraseñas no coinciden'}), 400

    error_contrasena = validar_contrasena(contrasena_nueva)
    if error_contrasena:
        return jsonify({'error': error_contrasena}), 400
    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Obtiene el hash de la contraseña actual del usuario
        cursor.execute("SELECT contrasena_hash FROM usuario WHERE id_usuario = %s", (id_usuario,))
        usuario = cursor.fetchone()

        # Verifica que la contraseña actual sea correcta
        if not check_password_hash(usuario['contrasena_hash'], contrasena_actual):
            cursor.close()
            db.close()
            return jsonify({'error': 'La contraseña actual es incorrecta'}), 400

        # Genera el hash de la nueva contraseña
        contrasena_hash = generate_password_hash(contrasena_nueva)

        # Actualiza la contraseña en la BD
        cursor.execute("""
            UPDATE usuario SET contrasena_hash = %s
            WHERE id_usuario = %s
        """, (contrasena_hash, id_usuario))

        db.commit()
        cursor.close()
        db.close()

        return jsonify({'mensaje': 'Contraseña cambiada correctamente'}), 200

    except psycopg2.Error as e:
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/usuario/cambiar-perfil', methods=['PUT'])
def api_cambiar_perfil():
    """
    Cambia el perfil activo del usuario entre Conductor y Administrador.
    Para cambiar a Administrador el usuario debe tener un parqueadero registrado.
    Para cambiar a Conductor no hay restricciones.

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Recibe (JSON):
        - perfil: ID del perfil al que quiere cambiar (1=Conductor, 2=Administrador)

    Retorna:
        200: Perfil cambiado correctamente
        400: Perfil inválido o sin parqueadero registrado
        401: No hay sesión activa
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    datos = request.get_json()
    id_perfil = datos.get('perfil')

    # Verifica que el perfil sea válido (1=Conductor, 2=Administrador)
    if id_perfil not in [1, 2]:
        return jsonify({'error': 'Perfil inválido'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Si quiere cambiar a Administrador verifica que tenga parqueadero
        # y guarda su ID en sesión: todas las rutas de control de acceso y
        # movimientos (/api/control-acceso/*, /api/movimientos) dependen de
        # session['id_parqueadero'] para saber a qué parqueadero consultar.
        id_parqueadero_admin = None
        if id_perfil == 2:
            cursor.execute("""
                SELECT id_parqueadero FROM parqueadero
                WHERE id_usuario = %s AND estado = 'activo'
            """, (id_usuario,))
            parqueadero = cursor.fetchone()
            if not parqueadero:
                cursor.close()
                db.close()
                return jsonify({'error': 'Debes registrar un parqueadero para ser Administrador'}), 400
            id_parqueadero_admin = parqueadero['id_parqueadero']

        # Verifica que el usuario tenga ese perfil asignado en usuario_perfil
        cursor.execute("""
            SELECT id_usuario_perfil FROM usuario_perfil
            WHERE id_usuario = %s AND id_tipo_perfil = %s AND estado = 'activo'
        """, (id_usuario, id_perfil))
        if not cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'No tienes ese perfil habilitado'}), 400

        # Actualiza el perfil activo en la tabla usuario
        cursor.execute("""
            UPDATE usuario SET id_perfil_activo = %s
            WHERE id_usuario = %s
        """, (id_perfil, id_usuario))

        db.commit()
        cursor.close()
        db.close()

        # Actualiza el perfil en la sesión
        session['perfil'] = 'Conductor' if id_perfil == 1 else 'Administrador'

        if id_perfil == 2:
            # Sin esta línea, session['id_parqueadero'] solo quedaba
            # asignado en el login (ver auth.py). Cualquier usuario que
            # cambiara de perfil DESDE la app (sin volver a hacer login)
            # se quedaba con id_parqueadero desactualizado o en None.
            session['id_parqueadero'] = id_parqueadero_admin
        else:
            # Al volver a perfil Conductor, se limpia para evitar que quede
            # un id_parqueadero de sesiones anteriores.
            session.pop('id_parqueadero', None)

        return jsonify({
            'mensaje': 'Perfil actualizado correctamente',
            'perfil': session['perfil']
        }), 200

    except psycopg2.Error as e:
        current_app.logger.error(f"Error al cambiar de perfil: {e}")
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/usuario/eliminar', methods=['DELETE'])
def api_eliminar():
    """
    Desactiva la cuenta del usuario logueado.
    No elimina el registro de la BD, solo cambia el estado a inactivo.

    Requiere:
        - Sesión activa (id_usuario en sesión)

    Retorna:
        200: Cuenta desactivada correctamente
        401: No hay sesión activa
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Cambia el estado a inactivo en vez de borrar el registro
        # Esto preserva el historial de movimientos y calificaciones
        cursor.execute("""
            UPDATE usuario SET estado = 'inactivo'
            WHERE id_usuario = %s
        """, (id_usuario,))

        db.commit()
        cursor.close()
        db.close()

        # Limpia la sesión del usuario
        session.clear()

        return jsonify({'mensaje': 'Cuenta desactivada correctamente'}), 200

    except psycopg2.Error as e:
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/vehiculos/tipos', methods=['GET'])
def api_tipos_vehiculo():
    """
    Retorna el catálogo de tipos de vehículo activos.

    Retorna:
        200: Lista de tipos de vehículo
        500: Error de base de datos
    """
    try:
        db = get_db(current_app)
        cursor = db.cursor()
        cursor.execute("""
            SELECT id_tipo_vehiculo, descripcion
            FROM tipo_vehiculo
            WHERE estado = 'activo'
            ORDER BY descripcion
        """)
        tipos = cursor.fetchall()
        cursor.close()
        db.close()
        return jsonify(tipos), 200
    except psycopg2.Error:
        return jsonify({'error': 'Error de base de datos'}), 500


@usuario_bp.route('/api/vehiculos', methods=['GET'])
def api_listar_vehiculos():
    """
    Retorna los vehículos activos del usuario logueado.

    Retorna:
        200: Lista de vehículos
        401: No hay sesión activa
        500: Error de base de datos
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401
    
    try:
        db = get_db(current_app)
        cursor = db.cursor()
        cursor.execute("""
            SELECT v.id_vehiculo, v.placa, v.estado, v.fecha_registro,
                   tv.id_tipo_vehiculo, tv.descripcion AS tipo_vehiculo
            FROM vehiculo v
            JOIN tipo_vehiculo tv ON v.id_tipo_vehiculo = tv.id_tipo_vehiculo
            WHERE v.id_usuario = %s
            ORDER BY v.fecha_registro DESC
        """, (id_usuario,))
        vehiculos = cursor.fetchall()
        cursor.close()
        db.close()
        return jsonify(vehiculos), 200
    except psycopg2.Error:
        return jsonify({'error': 'Error de base de datos'}), 500
    

@usuario_bp.route('/api/vehiculos', methods=['POST'])
def api_agregar_vehiculo():
    id_usuario_sesion = session.get('id_usuario')
    if not id_usuario_sesion:
        return jsonify({'error': 'No hay sesión activa'}), 401
    
    try:
        id_usuario = int(id_usuario_sesion)
    except (ValueError, TypeError):
        return jsonify({'error': 'Sesión de usuario inválida'}), 401

    datos = request.get_json()
    id_tipo_vehiculo = datos.get('id_tipo_vehiculo')
    placa_origen = datos.get('placa', '').strip().upper()

    es_bicicleta = int(id_tipo_vehiculo) == 3
    placa_final = None if es_bicicleta else placa_origen


    if not id_tipo_vehiculo or (not es_bicicleta and not placa_final):
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        if not es_bicicleta:
            cursor.execute("""
                SELECT id_vehiculo FROM vehiculo 
                WHERE placa = %s AND estado = 'activo'
            """, (placa_final,))
            if cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({'error': 'La placa ya está registrada en un vehículo activo'}), 400

        cursor.execute("""
            INSERT INTO vehiculo (id_usuario, id_tipo_vehiculo, placa)
            VALUES (%s, %s, %s)
        """, (id_usuario, id_tipo_vehiculo, placa_final))

        db.commit()
        cursor.close()
        db.close()
        return jsonify({'mensaje': 'Vehículo registrado correctamente'}), 201

    except psycopg2.Error as e:
        if '45000' in str(e):
            return jsonify({'error': 'Ya tienes 5 vehículos activos registrados'}), 400
        return jsonify({'error': 'Ya tienes 5 vehículos activos registrados'}), 500

@usuario_bp.route('/api/vehiculos/<int:id_vehiculo>', methods=['PUT'])
def api_modificar_vehiculo(id_vehiculo):
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    datos = request.get_json()
    id_tipo_vehiculo = datos.get('id_tipo_vehiculo')
    placa = datos.get('placa', '').strip().upper()

    if int(id_tipo_vehiculo) == 3:
        placa = None
    elif not placa:
        return jsonify({'error': 'La placa es obligatoria'}), 400

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        cursor.execute("""
            SELECT id_vehiculo FROM vehiculo
            WHERE id_vehiculo = %s AND id_usuario = %s AND estado = 'activo'
        """, (id_vehiculo, id_usuario))
        if not cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'Vehículo no encontrado o no autorizado'}), 403

        cursor.execute("""
            SELECT id_vehiculo FROM vehiculo 
            WHERE placa = %s AND id_vehiculo != %s AND estado = 'activo'
        """, (placa, id_vehiculo))
        if cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'La placa ya está registrada en otro vehículo'}), 400

        cursor.execute("""
            UPDATE vehiculo 
            SET id_tipo_vehiculo = %s, placa = %s
            WHERE id_vehiculo = %s AND id_usuario = %s
        """, (id_tipo_vehiculo, placa, id_vehiculo, id_usuario))

        db.commit()
        cursor.close()
        db.close()
        return jsonify({'mensaje': 'Vehículo actualizado correctamente'}), 200

    except psycopg2.Error:
        return jsonify({'error': 'Error de base de datos'}), 500
    
@usuario_bp.route('/api/vehiculos/<int:id_vehiculo>', methods=['DELETE'])
def api_eliminar_vehiculo(id_vehiculo):
    """
    Desactiva un vehículo del usuario logueado (soft delete).
    """
    id_usuario = session.get('id_usuario')
    if not id_usuario:
        return jsonify({'error': 'No hay sesión activa'}), 401

    try:
        db = get_db(current_app)
        cursor = db.cursor()

        # Verificar que el vehículo exista, esté activo y pertenezca al usuario
        cursor.execute("""
            SELECT id_vehiculo FROM vehiculo
            WHERE id_vehiculo = %s AND id_usuario = %s AND estado = 'activo'
        """, (id_vehiculo, id_usuario))
        
        if not cursor.fetchone():
            cursor.close()
            db.close()
            return jsonify({'error': 'Vehículo no encontrado'}), 403

        # Soft delete: libera la placa del índice único concatenando un sufijo irrepetible
        cursor.execute("""
            UPDATE vehiculo
            SET estado = 'inactivo',
                placa = CONCAT('BAJA_', %s, '_', COALESCE(placa, 'SIN_PLACA'))
            WHERE id_vehiculo = %s
        """, (id_vehiculo, id_vehiculo))

        # Confirmar la transacción en la base de datos
        db.commit()

        cursor.close()
        db.close()
        return jsonify({'mensaje': 'Vehículo eliminado correctamente'}), 200

    except psycopg2.Error:
        return jsonify({'error': 'Error de base de datos'}), 500

@usuario_bp.route('/api/usuario/logout', methods=['POST'])
def api_logout():
    """
    Cierra la sesión del usuario logueado.
    Elimina todos los datos guardados en la sesión.

    Retorna:
        200: Sesión cerrada correctamente
    """
    # Elimina todos los datos de la sesión
    session.clear()
    return jsonify({'mensaje': 'Sesión cerrada correctamente'}), 200

