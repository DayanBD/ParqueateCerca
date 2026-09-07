"""
Núcleo de la aplicación Flask.
Aquí se inicializan las extensiones y se registran los blueprints.
"""
from flask import Flask
from flask_mail import Mail
import psycopg2
from psycopg2.extras import RealDictCursor
from config import Config

# Se crea el objeto mail sin configurar todavía
# Se configura dentro de create_app() para evitar
# problemas de importación circular
mail = Mail()

def get_db(app):
    """
    Abre y devuelve una conexión a la base de datos PostgreSQL (Supabase).
    Se llama cada vez que una ruta necesita consultar la BD.
    RealDictCursor permite acceder a los resultados por nombre
    de columna en vez de por posición (igual que DictCursor en MySQL).
    autocommit=True confirma cada operación de escritura
    de forma automática sin requerir commit() explícito.
    """
    # Se conecta usando la URL completa en lugar de parámetros separados
    conn = psycopg2.connect(
        app.config['DATABASE_URL'],
        cursor_factory=RealDictCursor
    )
    
    # Equivalente a autocommit=True de pymysql
    conn.autocommit = True
    
    # Equivalente al init_command para forzar la zona horaria a UTC-5 (Bogotá)
    with conn.cursor() as cursor:
        cursor.execute("SET TIME ZONE '-05:00'")
        
    return conn

def create_app():
    """
    Función fábrica de la aplicación Flask.
    Crea, configura y devuelve la app lista para usarse.
    Usar una función fábrica permite tener diferentes 
    configuraciones para desarrollo, pruebas y producción. 
    """
    # Crea la app indicando dónde están los templates y archivos estáticos
    app = Flask(__name__,
                template_folder='templates',
                static_folder='static')
    
    # Carga la configuración desde config.py
    app.config.from_object(Config)

    # Vincula Flask-Mail con la app ya configurada
    mail.init_app(app)

    # Registra el blueprint de autenticación
    # Importación aquí adentro para evitar importaciones circulares
    from app.routes.auth import auth_bp
    app.register_blueprint(auth_bp)

    # Registra el blueprint de usuario
    from app.routes.usuario import usuario_bp
    app.register_blueprint(usuario_bp)

    return app