/**
 * Canonical shapes produced by this scraper.
 *
 * These names are the CONTRACT with any host application. Source field names
 * (Hebrew-transliterated ArcGIS columns) never leak past normalize.js, except
 * inside `sourceFields`, which intentionally carries every raw attribute so no
 * information is lost before we know what we want.
 *
 * Dates are ISO-8601 strings (UTC) or null. Geometry is GeoJSON in WGS84.
 */

/** Entity kinds this scraper can emit. */
const KIND = {
	/** בקשות והיתרי בניה - building permit requests and granted permits. */
	PERMIT: 'building_permit',
	/** אתרי בניה - active construction sites under supervision. */
	SITE: 'construction_site',
};

/**
 * Ordered lifecycle ladder for permits (`building_stage` in the source).
 * Index === progression. Used to detect *advancement* rather than any change,
 * so an alert can say "this moved forward" and not merely "this row differs".
 */
const PERMIT_STAGES = [
	'בתהליך היתר', // permit in process
	'קיים היתר', // permit granted  <-- construction becomes imminent
	'בבניה', // under construction
	'קיימת לפחות תעודת גמר אחת', // at least one completion certificate
	'קיים אכלוס', // occupied
];

/**
 * Ordered on-site build progression for construction sites (`matzav_bniya`).
 * '' (empty) is a real value in the source and sorts first.
 */
const SITE_STAGES = [
	'',
	'פתיחת תיק', // file opened
	'פיצול תיק לבניה בשלבים', // file split for phased construction
	'תחילת עבודות', // works started
	'עבודות עפר וביסוס', // earthworks and foundation
	'גמר יסודות', // foundations complete
	'גמר שלד', // frame complete
	'גמר בניה', // construction complete
];

/**
 * Stage that means "approved, construction is imminent" - the primary alert
 * trigger for notifying residents before building starts nearby.
 */
const STAGE_PERMIT_GRANTED = 'קיים היתר';

/**
 * @typedef {Object} BuildingPermit
 * @property {'building_permit'} kind
 * @property {string}      city          Municipality code ('tlv'). Namespaces keys.
 * @property {string|null} cityName      Display name ('תל אביב-יפו')
 * @property {string}      sourceId      Stable per-layer id (`oid_permit`), as string.
 * @property {string}      dedupeKey     See dedupe.js. Stable across crawls; one per polygon.
 * @property {string}      groupKey      Shared by all polygons of one multi-parcel permit.
 * @property {number|null} requestNumber מספר בקשה
 * @property {number|null} permitNumber  מספר היתר (0 in source means "none")
 * @property {string|null} title         כותרת
 * @property {string|null} stage         building_stage; one of PERMIT_STAGES
 * @property {number|null} stageOrder    Index in PERMIT_STAGES, or null if unknown
 * @property {number|null} progress      Source's own numeric sort key
 * @property {string|null} requestStage  שלב בקשה (numeric code as string)
 * @property {string|null} requestType   סוג בקשה
 * @property {string|null} requestContent תוכן בקשה (long free text)
 * @property {string|null} licensingTrack מסלול רישוי
 * @property {string|null} sourceClass    סיווג מקור
 * @property {string|null} address        כתובות (may list several, comma separated)
 * @property {number|null} buildingFileId מס' תיק בניין - joins to sites
 * @property {number|null} buildingCode   קוד בניין
 * @property {number|null} housingUnits   יחידות דיור
 * @property {string[]}    trackingFiles  tik_tipul_1..5, non-empty only. Joins to ConstructionSite.trackingFile
 * @property {Object}      tama38        {applies, isNew, isAddition} - תמ"א 38 flags
 * @property {Object}      relief        הקלה fields (percent additions, text, reasoning)
 * @property {string|null} requestOpenedAt   ISO. תאריך פתיחת בקשה
 * @property {string|null} permitGrantedAt   ISO. תאריך היתר - the "promoted" moment
 * @property {string|null} permitExpiresAt   ISO. תאריך תוקף היתר
 * @property {string|null} constructionStartedAt ISO. תאריך התחלת בניה
 * @property {string|null} completedAt    Raw string in source (not a real date field)
 * @property {string|null} occupancyAt    Raw string in source (not a real date field)
 * @property {string|null} documentUrl    קישור למסמך
 * @property {string|null} importedAt     ISO. Source's own layer-refresh timestamp
 * @property {Object|null} geometry       GeoJSON Polygon or MultiPolygon, WGS84.
 *                                        Measured: ~0.5% of permits are MultiPolygon,
 *                                        so consumers must handle both.
 * @property {Object}      sourceFields   Every raw attribute, verbatim
 */

/**
 * @typedef {Object} ConstructionSite
 * @property {'construction_site'} kind
 * @property {string}      city          Municipality code
 * @property {string|null} cityName      Display name
 * @property {string}      sourceId      Stable per-layer id (`oid_site`), as string.
 * @property {string}      dedupeKey     See dedupe.js. One per polygon.
 * @property {string}      groupKey      Shared by all polygons of one supervision file.
 * @property {string|null} trackingFile  תיק טיפול - joins to BuildingPermit.trackingFiles
 * @property {string|null} permitsInFile היתרים בתיק
 * @property {string|null} supervisionStatus סטטוס תיק; 22 possible values
 * @property {string|null} supervisionStatusAt ISO. מתאריך
 * @property {string|null} buildStage    שלב בניה; one of SITE_STAGES
 * @property {number|null} buildStageOrder Index in SITE_STAGES, or null
 * @property {string|null} worksApprovedAt ISO. ת. אישור עבודות
 * @property {string|null} landUse       יעוד (long, comma separated)
 * @property {string|null} permitHolders בעלי היתר
 * @property {string|null} licensingTrack מסלול רישוי
 * @property {string|null} requestType   מהות
 * @property {string|null} requestContent תוכן בבקשה
 * @property {string|null} address       כתובת
 * @property {number|null} buildingFileId תיק בניין - joins to permits
 * @property {string|null} blockParcel   גושים/חלקות
 * @property {string|null} nightWorkPermit אישור לעבודות לילה
 * @property {string|null} archiveUrl    לינק לארכיון לתיק בניין
 * @property {string|null} importedAt    ISO
 * @property {Object|null} geometry      GeoJSON Polygon or MultiPolygon, WGS84
 * @property {Object}      sourceFields  Every raw attribute, verbatim
 */

/**
 * @typedef {Object} StatusChange
 * @property {string}  dedupeKey
 * @property {string}  kind
 * @property {string}  field       Which tracked field changed
 * @property {*}       from
 * @property {*}       to
 * @property {boolean} advanced    True when the change moved forward along the ladder
 * @property {Object}  record      The new version of the record
 */

/**
 * Fields whose between-crawl changes are worth recording. Date fields are
 * excluded on purpose: they carry their own history inside the record, so a
 * change to them is already visible without a diff.
 */
const TRACKED_FIELDS = {
	[KIND.PERMIT]: ['stage', 'requestStage', 'progress', 'permitNumber', 'permitGrantedAt', 'constructionStartedAt'],
	[KIND.SITE]: ['supervisionStatus', 'buildStage', 'worksApprovedAt'],
};

module.exports = {
	KIND,
	PERMIT_STAGES,
	SITE_STAGES,
	STAGE_PERMIT_GRANTED,
	TRACKED_FIELDS,
};
