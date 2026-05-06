var meter_export = Class.create();
meter_export.prototype = {

    // =========================================================
    // Initialisierung und zentrale Konfiguration
    // =========================================================

    initialize: function() {
        this.EXPORT_TABLE     = "u_meter_export";
        this.STATUS_CREATED   = "created";
        this.STATUS_FORWARDED = "forwarded";
        this.STATUS_FAILED    = "failed";
    },

    // =========================================================
    // Offene TXT-Exporte sammeln und zusammenführen
    // Aggregiert alle Exporte im Status "created" und normaliert Zeilenumbrüche
    // =========================================================

    exportCreatedTxt: function(maxCount) {
        var result = {
            ok: false,
            message: "",
            payload: "",
            file_count: 0,
            export_ids: []
        };

        try {
            var payloadParts = [];
            var gr = new GlideRecord(this.EXPORT_TABLE);

            // Nur noch nicht weitergeleitete Exporte, älteste zuerst
            gr.addQuery("u_status", this.STATUS_CREATED);
            gr.orderBy("sys_created_on");

            // Optionale Mengenbegrenzung für Batch-Processing
            var limit = parseInt(maxCount, 10);
            if (!isNaN(limit) && limit > 0) {
                gr.setLimit(limit);
            }

            gr.query();

            while (gr.next()) {
                var exportId = String(gr.getUniqueValue() || "");
                var content  = this.readLatestAttachmentContent(exportId);

                // Exporte ohne lesbaren Inhalt werden als fehlerhaft markiert und übersprungen
                if (!content) {
                    this.markExportFailed(exportId, "Kein lesbarer Attachment-Inhalt gefunden.");
                    gs.warn("meter_export exportCreatedTxt: skipped empty export | export_id=" + exportId);
                    continue;
                }

                payloadParts.push(this.normalizeLineBreaks(content));
                result.export_ids.push(exportId);
                result.file_count++;
            }

            if (payloadParts.length === 0) {
                result.message = "Keine offenen Exportdateien gefunden.";
                return result;
            }

            result.payload = payloadParts.join("\n");
            result.ok      = true;
            result.message = "Export erfolgreich zusammengestellt (" + result.file_count + " Dateien).";

            gs.info("meter_export exportCreatedTxt OK | count=" + result.file_count);
            return result;

        } catch (e) {
            gs.error("meter_export exportCreatedTxt ERROR: " + e + " | " + e.stack);
            result.message = "Fehler beim Export-Zusammenstellen.";
            return result;
        }
    },

    // =========================================================
    // Attachment-Inhalt eines Exportdatensatzes lesen
    // Liest das neueste Attachment (UTF-8 kodiert) eines Export-Records
    // =========================================================

    readLatestAttachmentContent: function(exportSysId) {
        try {
            // Nur das neueste Attachment wird gelesen
            var att = new GlideRecord("sys_attachment");
            att.addQuery("table_name",   this.EXPORT_TABLE);
            att.addQuery("table_sys_id", exportSysId);
            att.orderByDesc("sys_created_on");
            att.setLimit(1);
            att.query();

            if (!att.next()) {
                return "";
            }

            var bytes = new GlideSysAttachment().getBytes(att);

            if (!bytes || bytes.length === 0) {
                return "";
            }

            // TXT-Inhalt als UTF-8 lesen
            return String(new Packages.java.lang.String(bytes, "UTF-8"));

        } catch (e) {
            gs.warn("meter_export readLatestAttachmentContent ERROR | export_id=" + exportSysId + " | " + e);
            return "";
        }
    },

    // =========================================================
    // Fehlerstatus für Exportdatensätze setzen
    // =========================================================

    markExportFailed: function(exportSysId, message) {
        try {
            var gr = new GlideRecord(this.EXPORT_TABLE);
            if (!gr.get(exportSysId)) {
                return false;
            }
            gr.setValue("u_status",        this.STATUS_FAILED);
            gr.setValue("u_error_message", String(message || "Export fehlgeschlagen."));
            gr.update();
            
            gs.warn("meter_export marked failed | export_id=" + exportSysId + " | reason=" + message);
            return true;
        } catch (e) {
            gs.error("meter_export markExportFailed ERROR | export_id=" + exportSysId + " | " + e);
            return false;
        }
    },

    // =========================================================
    // Erfolgreich weitergeleitete Exporte abschließen
    // Setzt Status auf "forwarded" und Zeitstempel – essentiell für at-least-once Semantik
    // =========================================================

    markAsForwarded: function(exportIds) {
        var result = { ok: true, updated: 0 };

        try {
            if (!exportIds || !exportIds.length) {
                return result;  // Keine IDs, nichts zu tun
            }

            for (var i = 0; i < exportIds.length; i++) {
                var gr = new GlideRecord(this.EXPORT_TABLE);
                if (!gr.get(exportIds[i])) {
                    gs.warn("meter_export markAsForwarded: export not found | id=" + exportIds[i]);
                    continue;
                }
                if (String(gr.getValue("u_status") || "") !== this.STATUS_CREATED) {
                    gs.warn(
                        "meter_export markAsForwarded: unexpected status | id=" + exportIds[i] +
                        " | status=" + gr.getValue("u_status")
                    );
                    continue;
                }

                gr.setValue("u_status",        this.STATUS_FORWARDED);
                gr.setValue("u_exported_at",   new GlideDateTime());
                gr.setValue("u_error_message", "");
                gr.update();
                result.updated++;
            }

            if (result.updated > 0) {
                gs.info("meter_export markAsForwarded OK | count=" + result.updated);
            }

            return result;

        } catch (e) {
            gs.error("meter_export markAsForwarded ERROR: " + e + " | " + e.stack);
            return { ok: false, updated: result.updated };
        }
    },

    // =========================================================
    // Abgelaufene Exporte und Attachments löschen
    // Wichtig für Speicherverwaltung und Datenschutz (Aufbewahrungsfrist)
    // =========================================================

    deleteExpiredExports: function() {
        var result = { ok: true, deleted_exports: 0, deleted_attachments: 0 };

        try {
            var now = new GlideDateTime();
            var gsa = new GlideSysAttachment();
            var gr  = new GlideRecord(this.EXPORT_TABLE);

            gr.addQuery("u_delete_after", "<=", now);
            gr.query();

            while (gr.next()) {
                var delAttCount = this.deleteAttachmentsForRecord(gr.getUniqueValue(), gsa);
                result.deleted_attachments += delAttCount;
                gr.deleteRecord();
                result.deleted_exports++;
            }

            if (result.deleted_exports > 0) {
                gs.info(
                    "meter_export deleteExpiredExports OK" +
                    " | exports=" + result.deleted_exports +
                    " | attachments=" + result.deleted_attachments
                );
            }

            return result;

        } catch (e) {
            gs.error("meter_export deleteExpiredExports ERROR: " + e + " | " + e.stack);
            return { ok: false, deleted_exports: 0, deleted_attachments: 0 };
        }
    },

    deleteAttachmentsForRecord: function(exportSysId, gsa) {
        var deletedCount = 0;
        try {
            var att = new GlideRecord("sys_attachment");
            att.addQuery("table_name",   this.EXPORT_TABLE);
            att.addQuery("table_sys_id", exportSysId);
            att.query();
            while (att.next()) {
                gsa.deleteAttachment(att.getUniqueValue());
                deletedCount++;
            }
        } catch (e) {
            gs.warn("meter_export deleteAttachmentsForRecord ERROR: " + e + " | export_id=" + exportSysId);
        }
        return deletedCount;
    },

    // CRLF und lone CR auf \n vereinheitlichen – Reihenfolge ist relevant.
    normalizeLineBreaks: function(text) {
        return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    },

    type: "meter_export"
};