import mongoose from "mongoose";

const PIPELINE_STAGES = [
  "discovered",
  "qualified",
  "contacted",
  "responded",
  "negotiating",
  "converted",
  "lost",
  "ignored",
];

const CONTACT_MODES = [
  "whatsapp",
  "email",
  "call",
  "instagram_dm",
  "facebook_dm",
  "visit",
  "other",
];

const stageHistorySchema = new mongoose.Schema(
  {
    stage: {
      type: String,
      enum: PIPELINE_STAGES,
      required: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    contactMode: {
      type: String,
      enum: ["", ...CONTACT_MODES],
      default: "",
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    website: {
      type: String,
      default: "",
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    email: {
      type: String,
      default: "",
      trim: true,
    },
    googleMapsUrl: {
      type: String,
      default: "",
      trim: true,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    audit: {
      performanceScore: { type: Number, default: null },
      accessibilityScore: { type: Number, default: null },
      bestPracticesScore: { type: Number, default: null },
      seoScore: { type: Number, default: null },
      firstContentfulPaint: { type: Number, default: null },
      largestContentfulPaint: { type: Number, default: null },
      cumulativeLayoutShift: { type: Number, default: null },
      totalBlockingTime: { type: Number, default: null },
      auditedAt: { type: Date, default: null },
    },
    websiteSnapshot: {
      title: { type: String, default: "" },
      description: { type: String, default: "" },
      hasMenuPage: { type: Boolean, default: false },
      hasReservationFlow: { type: Boolean, default: false },
      hasOnlineOrdering: { type: Boolean, default: false },
      whatsappLink: { type: String, default: "", trim: true },
      whatsappPhone: { type: String, default: "", trim: true },
      whatsappCheckLink: { type: String, default: "", trim: true },
      whatsappStatus: {
        type: String,
        enum: ["unknown", "likely", "confirmed"],
        default: "unknown",
      },
      socialLinks: { type: [String], default: [] },
      brokenLinks: { type: Number, default: 0 },
    },
    externalProfiles: {
      facebook: {
        url: { type: String, default: "", trim: true },
        email: { type: String, default: "", trim: true },
        phone: { type: String, default: "", trim: true },
        scrapedAt: { type: Date, default: null },
      },
      tripadvisor: {
        url: { type: String, default: "", trim: true },
        email: { type: String, default: "", trim: true },
        phone: { type: String, default: "", trim: true },
        scrapedAt: { type: Date, default: null },
      },
    },
    detectedIssues: {
      type: [String],
      default: [],
    },
    opportunityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    scoreReason: {
      type: String,
      default: "",
    },
    outreach: {
      recommendedChannel: { type: String, default: "cold_email" },
      channelReason: { type: String, default: "" },
      quickScore10: { type: Number, default: null },
      quickScoreReason: { type: String, default: "" },
      topProblemsDetailed: {
        type: [
          {
            title: { type: String, default: "", trim: true },
            what: { type: String, default: "", trim: true },
            whoItLoses: { type: String, default: "", trim: true },
            revenueImpact: { type: String, default: "", trim: true },
          },
        ],
        default: [],
      },
      outreachMessage: { type: String, default: "" },
      followUpHook: { type: String, default: "" },
      detailedAnalysis: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
    },
    stage: {
      type: String,
      enum: PIPELINE_STAGES,
      default: "discovered",
    },
    stageHistory: {
      type: [stageHistorySchema],
      default: [{ stage: "discovered", note: "Lead discovered" }],
    },
    lastContactedAt: {
      type: Date,
      default: null,
    },
    lastContactMode: {
      type: String,
      enum: ["", ...CONTACT_MODES],
      default: "",
      trim: true,
    },
    nextFollowUpAt: {
      type: Date,
      default: null,
    },
    source: {
      type: String,
      default: "google_maps",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

leadSchema.index({ name: 1, city: 1 }, { unique: true });
leadSchema.index({ opportunityScore: -1 });
leadSchema.index({ stage: 1 });

export { PIPELINE_STAGES, CONTACT_MODES };
export default mongoose.model("Lead", leadSchema);
