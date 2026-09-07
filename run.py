"""
Punto de entrada de la aplicación.
Este es el archivo que se ejecuta para arrancar el servidor Flask.
"""
from app import create_app
from flask_cors import CORS

# Crea la aplicación con toda su configuración
app = create_app()
CORS(app)

if __name__ == '__main__':
    # Solo arranca el servidor si se ejecuta directamente este archivo
    # debug=True recarga automaticamente al guardar los cambios
    # y muestra errores detallados en el navegador
    app.run(debug=True)