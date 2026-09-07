# le dice a Flask cuál es el archivo de entrada
FLASK_APP=run.py          

# activa el modo desarrollo
FLASK_ENV=development      # habilita el debugger y recarga automática al guardar

# clave para cifrar las sesiones de usuario
# en producción debe ser algo largo y aleatorio
SECRET_KEY=parqueate_dev_key

# ==========================================
# CONFIGURACIÓN DE BASE DE DATOS SUPABASE (POSTGRESQL)
# ==========================================
# URL de conexión directa para psycopg2 (sin SQLAlchemy)
# Asegúrate de usar el puerto 6543 (Connection Pooler) para evitar límite de conexiones
DATABASE_URL=postgresql://postgres.dvcgyjpoyvbleebpqmet:DayanelXd123@aws-0-us-west-2.pooler.supabase.com:6543/postgres

# ==========================================
# CREDENCIALES DE SERVICIOS
# ==========================================
MAIL_USERNAME=senasofiaplus905@gmail.com
MAIL_PASSWORD=tfkbiequerwstibw

# En Render: URL /exec del Web App de Apps Script y el mismo token
# configurado como MAIL_TOKEN en las propiedades del script.
# En local puedes dejarlas vacías para seguir usando Flask-Mail.
APPS_SCRIPT_URL=
APPS_SCRIPT_TOKEN=

SMS_GATEWAY_URL=http://186.169.77.44:8080
SMS_GATEWAY_USER=sms
SMS_GATEWAY_PASS=S1GY8Dum