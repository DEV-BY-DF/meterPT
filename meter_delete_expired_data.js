(function() {

    try {
        var exportResult  = new meter_export().deleteExpiredExports();
        var stagingResult = new meter_processing().deleteExpiredStaging();

        var exportOk           = exportResult  && exportResult.ok;
        var stagingOk          = stagingResult && stagingResult.ok;
        var deletedExports     = exportResult  ? exportResult.deleted_exports     : 0;
        var deletedAttachments = exportResult  ? exportResult.deleted_attachments : 0;
        var deletedStaging     = stagingResult ? stagingResult.deleted_staging    : 0;

        gs.info(
            "meter_delete_expired_data" +
            " | export_ok="           + exportOk +
            " | deleted_exports="     + deletedExports +
            " | deleted_attachments=" + deletedAttachments +
            " | staging_ok="          + stagingOk +
            " | deleted_staging="     + deletedStaging
        );

        if (!exportOk || !stagingOk) {
            gs.warn(
                "meter_delete_expired_data | Lauf ohne vollständig erfolgreiches Ergebnis" +
                " | deleted_exports="     + deletedExports +
                " | deleted_attachments=" + deletedAttachments +
                " | deleted_staging="     + deletedStaging
            );
        }

    } catch (e) {
        gs.error("meter_delete_expired_data ERROR: " + e);
    }

})();