import os # módulo de Python para leer variables del sistema operativo

class Config:
    """
    Configuración central de la aplicación.
    Lee las variables del .flaskenv mediante os.environ.get().
    El segundo parámetro es el valor por defecto si la variable no existe.
    """

    # Clave secreta para cifrar las sesiones de usuario
    # En producción debe ser cadena larga y aleatoria
    SECRET_KEY = os.environ.get('SECRET_KEY', 'parqueate_dev_key')
    
    # —— Base de datos (Supabase / PostgreSQL sin SQLAlchemy) ———————————————————————————
    # URL de conexión directa para usar con psycopg2 o el cliente de Supabase
    DATABASE_URL = os.environ.get('DATABASE_URL', '')

    # —— Correo (Flask-Mail) ————————————————————————————————————————————————————————————————
    MAIL_SERVER = 'smtp.gmail.com'  # servidor Gmail para enviar correos
    MAIL_PORT = 587                 # puerto de conexión segura TLS
    MAIL_USE_TLS = True             # activa el cifrado TLS
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME', '') # correo remitente
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD', '') # contraseña del correo

    # Web App de Google Apps Script (envío de correos en Render).
    # Si APPS_SCRIPT_URL tiene valor, se usa en lugar de SMTP.
    APPS_SCRIPT_URL = os.environ.get('APPS_SCRIPT_URL', '')
    APPS_SCRIPT_TOKEN = os.environ.get('APPS_SCRIPT_TOKEN', '')

    # —— SMS Gateway ————————————————————————————————————————————————————————————————————————
    SMS_GATEWAY_URL = os.environ.get('SMS_GATEWAY_URL', '')
    SMS_GATEWAY_USER = os.environ.get('SMS_GATEWAY_USER', '')
    SMS_GATEWAY_PASS = os.environ.get('SMS_GATEWAY_PASS', '')