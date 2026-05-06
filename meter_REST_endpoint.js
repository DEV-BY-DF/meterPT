(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    var exporter     = new meter_export();
    var exportResult = exporter.exportCreatedTxt();

    if (!exportResult.ok) {
        response.setStatus(404);
        response.setBody({ ok: false, message: exportResult.message || "Keine Exportdaten verfügbar." });
        return;
    }

    var markResult = exporter.markAsForwarded(exportResult.export_ids);

    // Hinweis: Payload wird erst nach erfolgreichem Markieren gesendet.
    // Schlägt das Markieren fehl, werden dieselben Exporte beim nächsten Abruf
    // erneut zurückgegeben (at-least-once-Semantik).
    if (!markResult.ok) {
        response.setStatus(500);
        response.setBody({ ok: false, message: "Export erzeugt, Status konnte nicht aktualisiert werden." });
        return;
    }

    response.setStatus(200);
    response.setHeader("Content-Type", "text/plain");
    response.setBody(exportResult.payload);

})(request, response);