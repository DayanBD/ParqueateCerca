"""
Envío de correos de Parquéate Cerca.

En Render el SMTP de Gmail (Flask-Mail) suele fallar en el plan
gratuito. Si APPS_SCRIPT_URL está configurada, se envía un POST al
Web App de Google Apps Script, que usa GmailApp (cuota gratuita).
Si no hay URL, se usa Flask-Mail como respaldo en desarrollo local.
"""
from flask import current_app
from flask_mail import Message
from app import mail
import requests


def enviar_correo(destinatario, asunto, cuerpo):
    """
    Envía un correo de texto plano al destinatario.

    Recibe:
        - destinatario: correo de destino
        - asunto: asunto del mensaje
        - cuerpo: cuerpo en texto plano

    Retorna:
        bool: True si el proveedor aceptó el envío, False si falló.
        No lanza excepción hacia el llamador.
    """
    if not destinatario:
        return False

    url = (current_app.config.get('APPS_SCRIPT_URL') or '').strip()
    try:
        if url:
            return _enviar_por_apps_script(url, destinatario, asunto, cuerpo)
        return _enviar_por_smtp(destinatario, asunto, cuerpo)
    except Exception as e:
        current_app.logger.error(f"Error al enviar correo: {e}")
        return False


def _enviar_por_apps_script(url, destinatario, asunto, cuerpo):
    token = current_app.config.get('APPS_SCRIPT_TOKEN') or ''
    respuesta = requests.post(
        url,
        json={
            'token': token,
            'to': destinatario,
            'subject': asunto,
            'body': cuerpo,
        },
        headers={'Content-Type': 'application/json'},
        timeout=20,
    )
    if not respuesta.ok:
        current_app.logger.error(
            f"Apps Script respondió {respuesta.status_code}: {respuesta.text[:300]}"
        )
        return False

    try:
        datos = respuesta.json()
    except ValueError:
        # El Web App de Apps Script a veces entrega HTML de redirección;
        # un 200 ya indica que Google aceptó la petición.
        return True

    if datos.get('ok') is False:
        current_app.logger.error(f"Apps Script rechazó el envío: {datos.get('error')}")
        return False
    return True


def _enviar_por_smtp(destinatario, asunto, cuerpo):
    remitente = current_app.config.get('MAIL_USERNAME')
    if not remitente:
        current_app.logger.warning('MAIL_USERNAME no configurado; no se envió el correo.')
        return False

    msg = Message(subject=asunto, sender=remitente, recipients=[destinatario])
    msg.body = cuerpo
    mail.send(msg)
    return True
