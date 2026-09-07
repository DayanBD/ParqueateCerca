/**
 * Parquéate Cerca — Web App para enviar correos con Gmail (gratis).
 *
 * Cómo publicarlo:
 * 1. Ve a https://script.google.com y crea un proyecto nuevo.
 * 2. Pega este archivo y guarda.
 * 3. Archivo → Configuración del proyecto → Propiedades de secuencia.
 *    Agrega la propiedad MAIL_TOKEN con un texto secreto largo
 *    (el mismo valor que pondrás en APPS_SCRIPT_TOKEN de Render).
 * 4. Implementar → Nueva implementación → Tipo: Aplicación web.
 *    - Descripción: Enviar correo Parqueate Cerca
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier usuario (o "Cualquiera")
 * 5. Copia la URL que termina en /exec y pégala en Render como
 *    APPS_SCRIPT_URL. En Render también crea APPS_SCRIPT_TOKEN
 *    con el mismo MAIL_TOKEN del paso 3.
 * 6. Si cambias el código, vuelve a implementar (Nueva versión).
 */

function doPost(e) {
  var salida = ContentService.createTextOutput;
  var json = ContentService.MimeType.JSON;

  try {
    var datos = JSON.parse(e.postData.contents);
    var tokenEsperado = PropertiesService.getScriptProperties().getProperty('MAIL_TOKEN');

    if (!tokenEsperado || datos.token !== tokenEsperado) {
      return salida(JSON.stringify({ ok: false, error: 'No autorizado' })).setMimeType(json);
    }

    if (!datos.to || !datos.subject || !datos.body) {
      return salida(JSON.stringify({ ok: false, error: 'Faltan campos' })).setMimeType(json);
    }

    GmailApp.sendEmail(datos.to, datos.subject, datos.body);
    return salida(JSON.stringify({ ok: true })).setMimeType(json);
  } catch (err) {
    return salida(JSON.stringify({ ok: false, error: String(err) })).setMimeType(json);
  }
}
