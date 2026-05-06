(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    // Setzt alle Exporte im Status "created" auf "forwarded".
    // Aufruf nach erfolgreichem Download und Speichern der TXT.
    // Hinweis: GET für eine zustandsändernde Aktion ist nicht REST-konform –
    // für eine spätere saubere kVASy-Anbindung auf POST umstellen.

    try {
        var exportIds = [];
        var gr = new GlideRecord("u_meter_export");
        gr.addQuery("u_status", "created");
        gr.orderBy("sys_created_on");
        gr.query();

        while (gr.next()) {
            exportIds.push(String(gr.getUniqueValue()));
        }

        if (exportIds.length === 0) {
            response.setStatus(200);
            response.setBody({
                ok:      true,
                message: "Keine offenen Exporte vorhanden."
            });
            return;
        }

        var exporter   = new meter_export();
        var markResult = exporter.markAsForwarded(exportIds);

        if (!markResult.ok) {
            response.setStatus(500);
            response.setBody({
                ok:      false,
                message: "Status konnte nicht aktualisiert werden."
            });
            return;
        }

        response.setStatus(200);
        response.setBody({
            ok:      true,
            message: markResult.updated + " Export(e) als weitergeleitet markiert."
        });

    } catch (e) {
        gs.error("meter_REST_confirm ERROR: " + e);
        response.setStatus(500);
        response.setBody({
            ok:      false,
            message: "Fehler beim Bestätigen."
        });
    }

})(request, response);
