// ============================================================
// TYPES
// ============================================================

export type DocumentStatus = "missing" | "uploaded" | "under-review" | "approved" | "rejected";

export type ClearanceStatus =
  | "missing-documents"
  | "waiting-for-review"
  | "rejected-action-required"
  | "ready-for-clearance"
  | "in-clearance"
  | "released";

export type ShipmentStatus = "in-transit" | "at-port" | "customs-hold" | "cleared" | "delivered";

export type DocumentType =
  | "Commercial Invoice"
  | "Packing List"
  | "Phytosanitary Certificate"
  | "Bill of Lading"
  | "Certificate of Origin"
  | "Cooling Report"
  | "Insurance";

export type InvoiceStatus = "unpaid" | "partially-paid" | "paid";

export type ClaimStatus = "open" | "under-review" | "negotiation" | "resolved" | "closed";

export type LicenseStatus = "valid" | "expiring-soon" | "expired";

export const ALL_DOCUMENT_TYPES: DocumentType[] = [
  "Commercial Invoice",
  "Packing List",
  "Phytosanitary Certificate",
  "Bill of Lading",
  "Certificate of Origin",
  "Cooling Report",
  "Insurance",
];

export interface Supplier {
  id: string;
  name: string;
  country: string;
  contact: string;
}

export interface Product {
  id: string;
  name: string;
  hsCode: string;
}

export interface Document {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  containerId: string;
  shipmentId: string;
  uploadedBy?: string;
  uploadedAt?: string;
  reviewStatus?: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  internalNote?: string;
  documentNumber?: string;
  issueDate?: string;
  notes?: string;
}

export interface Container {
  id: string;
  shipmentId: string;
  containerNumber: string;
  containerType: "20ft" | "40ft" | "40ft HC" | "Reefer 40ft";
  temperature?: string;
  eta: string;
  clearanceStatus: ClearanceStatus;
  portOfLoading: string;
  portOfDestination: string;
}

export interface Shipment {
  id: string;
  supplierId: string;
  importerId: string;
  productId: string;
  originCountry: string;
  destinationPort: string;
  vesselName: string;
  etd: string;
  eta: string;
  status: ShipmentStatus;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  shipmentId: string;
  containerId?: string;
  type: string;
  description: string;
  timestamp: string;
  user?: string;
}

export interface Account {
  id: string;
  name: string;
  type: "supplier" | "importer" | "client";
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  lastPaymentDate: string;
}

export interface Invoice {
  id: string;
  accountId: string;
  invoiceNumber: string;
  date: string;
  relatedShipment?: string;
  relatedContainer?: string;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoiceStatus;
  swiftDocument?: string;
}

export interface Claim {
  id: string;
  containerId: string;
  containerNumber: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  claimType: string;
  description: string;
  amount: number;
  status: ClaimStatus;
  createdAt: string;
  messages: ClaimMessage[];
}

export interface ClaimMessage {
  id: string;
  sender: string;
  senderRole: "importer" | "supplier";
  text: string;
  timestamp: string;
  attachments?: { name: string; type: "image" | "video" | "document" }[];
}

export interface ImportLicense {
  id: string;
  supplierId: string;
  supplierName: string;
  licenseNumber: string;
  fileName: string;
  issueDate: string;
  expirationDate: string;
}

export interface CargoPhoto {
  id: string;
  containerId: string;
  url: string;
  type: "image" | "video";
  comment: string;
  uploadedAt: string;
  uploadedBy: string;
}

// ============================================================
// MOCK DATA
// ============================================================

export const mockSuppliers: Supplier[] = [
  { id: "SUP001", name: "FreshFruit Exports SA", country: "South Africa", contact: "johan@freshfruit.co.za" },
  { id: "SUP002", name: "AgroVerde Chile SpA", country: "Chile", contact: "maria@agroverde.cl" },
  { id: "SUP003", name: "Mediterranean Harvest Ltd", country: "Spain", contact: "carlos@medharvest.es" },
  { id: "SUP004", name: "Pacific Produce Co", country: "New Zealand", contact: "james@pacproduce.nz" },
];

export const mockProducts: Product[] = [
  { id: "PRD001", name: "Citrus Fruit (Oranges, Lemons)", hsCode: "0805.10" },
  { id: "PRD002", name: "Table Grapes", hsCode: "0806.10" },
  { id: "PRD003", name: "Avocados", hsCode: "0804.40" },
  { id: "PRD004", name: "Kiwifruit", hsCode: "0810.50" },
];

export const mockImporters = [
  { id: "IMP001", name: "EuroFresh Imports GmbH" },
  { id: "IMP002", name: "Atlantic Fresh Trading BV" },
];

export const mockShipments: Shipment[] = [
  {
    id: "SHP-2026-001",
    supplierId: "SUP001",
    importerId: "IMP001",
    productId: "PRD001",
    originCountry: "South Africa",
    destinationPort: "Rotterdam, NL",
    vesselName: "MSC Paloma",
    etd: "2026-02-25",
    eta: "2026-03-18",
    status: "at-port",
    createdAt: "2026-02-10",
  },
  {
    id: "SHP-2026-002",
    supplierId: "SUP002",
    importerId: "IMP001",
    productId: "PRD002",
    originCountry: "Chile",
    destinationPort: "Rotterdam, NL",
    vesselName: "CMA CGM Figaro",
    etd: "2026-03-01",
    eta: "2026-03-25",
    status: "in-transit",
    createdAt: "2026-02-15",
  },
  {
    id: "SHP-2026-003",
    supplierId: "SUP003",
    importerId: "IMP002",
    productId: "PRD003",
    originCountry: "Spain",
    destinationPort: "Hamburg, DE",
    vesselName: "Maersk Altair",
    etd: "2026-03-05",
    eta: "2026-03-12",
    status: "customs-hold",
    createdAt: "2026-02-28",
  },
  {
    id: "SHP-2026-004",
    supplierId: "SUP004",
    importerId: "IMP002",
    productId: "PRD004",
    originCountry: "New Zealand",
    destinationPort: "Antwerp, BE",
    vesselName: "Evergreen Harmony",
    etd: "2026-02-20",
    eta: "2026-03-28",
    status: "in-transit",
    createdAt: "2026-02-05",
  },
  {
    id: "SHP-2026-005",
    supplierId: "SUP001",
    importerId: "IMP001",
    productId: "PRD001",
    originCountry: "South Africa",
    destinationPort: "Rotterdam, NL",
    vesselName: "MSC Fantasia",
    etd: "2026-02-15",
    eta: "2026-03-08",
    status: "cleared",
    createdAt: "2026-01-28",
  },
];

export const mockContainers: Container[] = [
  // SHP-2026-001 containers
  { id: "CNT001", shipmentId: "SHP-2026-001", containerNumber: "MSCU-1234567", containerType: "Reefer 40ft", temperature: "-1\u00B0C", eta: "2026-03-18", clearanceStatus: "waiting-for-review", portOfLoading: "Cape Town", portOfDestination: "Rotterdam" },
  { id: "CNT002", shipmentId: "SHP-2026-001", containerNumber: "MSCU-1234568", containerType: "Reefer 40ft", temperature: "-1\u00B0C", eta: "2026-03-18", clearanceStatus: "rejected-action-required", portOfLoading: "Cape Town", portOfDestination: "Rotterdam" },
  // SHP-2026-002 containers
  { id: "CNT003", shipmentId: "SHP-2026-002", containerNumber: "CMAU-9876543", containerType: "Reefer 40ft", temperature: "0\u00B0C", eta: "2026-03-25", clearanceStatus: "missing-documents", portOfLoading: "Valparaiso", portOfDestination: "Rotterdam" },
  { id: "CNT004", shipmentId: "SHP-2026-002", containerNumber: "CMAU-9876544", containerType: "Reefer 40ft", temperature: "0\u00B0C", eta: "2026-03-25", clearanceStatus: "missing-documents", portOfLoading: "Valparaiso", portOfDestination: "Rotterdam" },
  { id: "CNT005", shipmentId: "SHP-2026-002", containerNumber: "CMAU-9876545", containerType: "Reefer 40ft", temperature: "0\u00B0C", eta: "2026-03-25", clearanceStatus: "waiting-for-review", portOfLoading: "Valparaiso", portOfDestination: "Rotterdam" },
  // SHP-2026-003 containers
  { id: "CNT006", shipmentId: "SHP-2026-003", containerNumber: "MSKU-5551234", containerType: "Reefer 40ft", temperature: "5\u00B0C", eta: "2026-03-12", clearanceStatus: "rejected-action-required", portOfLoading: "Valencia", portOfDestination: "Hamburg" },
  // SHP-2026-004 containers
  { id: "CNT007", shipmentId: "SHP-2026-004", containerNumber: "EGHU-7778889", containerType: "Reefer 40ft", temperature: "1\u00B0C", eta: "2026-03-28", clearanceStatus: "missing-documents", portOfLoading: "Auckland", portOfDestination: "Antwerp" },
  { id: "CNT008", shipmentId: "SHP-2026-004", containerNumber: "EGHU-7778890", containerType: "Reefer 40ft", temperature: "1\u00B0C", eta: "2026-03-28", clearanceStatus: "missing-documents", portOfLoading: "Auckland", portOfDestination: "Antwerp" },
  // SHP-2026-005 containers (cleared)
  { id: "CNT009", shipmentId: "SHP-2026-005", containerNumber: "MSCU-3334445", containerType: "Reefer 40ft", temperature: "-1\u00B0C", eta: "2026-03-08", clearanceStatus: "released", portOfLoading: "Cape Town", portOfDestination: "Rotterdam" },
  { id: "CNT010", shipmentId: "SHP-2026-005", containerNumber: "MSCU-3334446", containerType: "Reefer 40ft", temperature: "-1\u00B0C", eta: "2026-03-08", clearanceStatus: "released", portOfLoading: "Cape Town", portOfDestination: "Rotterdam" },
];

export const mockDocuments: Document[] = [
  // --- CNT001 (SHP-2026-001) -- waiting-for-review ---
  { id: "DOC001", type: "Commercial Invoice", status: "approved", containerId: "CNT001", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-12 09:30", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-14 11:00" },
  { id: "DOC002", type: "Packing List", status: "approved", containerId: "CNT001", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-12 09:35", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-14 11:10" },
  { id: "DOC003", type: "Phytosanitary Certificate", status: "under-review", containerId: "CNT001", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-03-01 14:20", reviewStatus: "pending" },
  { id: "DOC004", type: "Bill of Lading", status: "approved", containerId: "CNT001", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-26 10:00", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-28 09:00" },
  { id: "DOC005", type: "Certificate of Origin", status: "under-review", containerId: "CNT001", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-03-02 08:15", reviewStatus: "pending" },
  { id: "DOC006", type: "Cooling Report", status: "uploaded", containerId: "CNT001", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-03-05 16:00" },
  { id: "DOC007", type: "Insurance", status: "approved", containerId: "CNT001", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-12 10:00", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-14 12:00" },

  // --- CNT002 (SHP-2026-001) -- rejected-action-required ---
  { id: "DOC008", type: "Commercial Invoice", status: "approved", containerId: "CNT002", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-12 09:30", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-14 11:05" },
  { id: "DOC009", type: "Packing List", status: "rejected", containerId: "CNT002", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-12 09:40", reviewStatus: "rejected", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-14 11:20", rejectionReason: "Packing list does not match the quantities on the commercial invoice. Please correct item counts for pallets 5-8." },
  { id: "DOC010", type: "Phytosanitary Certificate", status: "approved", containerId: "CNT002", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-28 14:00", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-03-01 10:00" },
  { id: "DOC011", type: "Bill of Lading", status: "approved", containerId: "CNT002", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-26 10:05", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-28 09:10" },
  { id: "DOC012", type: "Certificate of Origin", status: "rejected", containerId: "CNT002", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-03-02 08:20", reviewStatus: "rejected", reviewedBy: "Agent De Vries", reviewedAt: "2026-03-04 14:30", rejectionReason: "Certificate of Origin is expired. Please upload a certificate with a valid date." },
  { id: "DOC013", type: "Cooling Report", status: "approved", containerId: "CNT002", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-03-05 16:10", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-03-06 09:00" },
  { id: "DOC014", type: "Insurance", status: "approved", containerId: "CNT002", shipmentId: "SHP-2026-001", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-12 10:05", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-14 12:05" },

  // --- CNT003 (SHP-2026-002) -- missing-documents ---
  { id: "DOC015", type: "Commercial Invoice", status: "uploaded", containerId: "CNT003", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-02-20 11:00" },
  { id: "DOC016", type: "Packing List", status: "uploaded", containerId: "CNT003", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-02-20 11:05" },
  { id: "DOC017", type: "Phytosanitary Certificate", status: "missing", containerId: "CNT003", shipmentId: "SHP-2026-002" },
  { id: "DOC018", type: "Bill of Lading", status: "missing", containerId: "CNT003", shipmentId: "SHP-2026-002" },
  { id: "DOC019", type: "Certificate of Origin", status: "missing", containerId: "CNT003", shipmentId: "SHP-2026-002" },
  { id: "DOC020", type: "Cooling Report", status: "missing", containerId: "CNT003", shipmentId: "SHP-2026-002" },
  { id: "DOC021", type: "Insurance", status: "uploaded", containerId: "CNT003", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-02-20 11:10" },

  // --- CNT004 (SHP-2026-002) -- missing-documents ---
  { id: "DOC022", type: "Commercial Invoice", status: "missing", containerId: "CNT004", shipmentId: "SHP-2026-002" },
  { id: "DOC023", type: "Packing List", status: "missing", containerId: "CNT004", shipmentId: "SHP-2026-002" },
  { id: "DOC024", type: "Phytosanitary Certificate", status: "missing", containerId: "CNT004", shipmentId: "SHP-2026-002" },
  { id: "DOC025", type: "Bill of Lading", status: "missing", containerId: "CNT004", shipmentId: "SHP-2026-002" },
  { id: "DOC026", type: "Certificate of Origin", status: "missing", containerId: "CNT004", shipmentId: "SHP-2026-002" },
  { id: "DOC027", type: "Cooling Report", status: "missing", containerId: "CNT004", shipmentId: "SHP-2026-002" },
  { id: "DOC028", type: "Insurance", status: "missing", containerId: "CNT004", shipmentId: "SHP-2026-002" },

  // --- CNT005 (SHP-2026-002) -- waiting-for-review ---
  { id: "DOC029", type: "Commercial Invoice", status: "under-review", containerId: "CNT005", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-02-22 09:00", reviewStatus: "pending" },
  { id: "DOC030", type: "Packing List", status: "under-review", containerId: "CNT005", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-02-22 09:05", reviewStatus: "pending" },
  { id: "DOC031", type: "Phytosanitary Certificate", status: "under-review", containerId: "CNT005", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-02-22 09:10", reviewStatus: "pending" },
  { id: "DOC032", type: "Bill of Lading", status: "under-review", containerId: "CNT005", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-03-02 10:00", reviewStatus: "pending" },
  { id: "DOC033", type: "Certificate of Origin", status: "under-review", containerId: "CNT005", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-03-02 10:05", reviewStatus: "pending" },
  { id: "DOC034", type: "Cooling Report", status: "under-review", containerId: "CNT005", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-03-03 14:00", reviewStatus: "pending" },
  { id: "DOC035", type: "Insurance", status: "approved", containerId: "CNT005", shipmentId: "SHP-2026-002", uploadedBy: "AgroVerde Chile SpA", uploadedAt: "2026-02-22 09:15", reviewStatus: "approved", reviewedBy: "Agent Muller", reviewedAt: "2026-02-24 10:00" },

  // --- CNT006 (SHP-2026-003) -- rejected-action-required ---
  { id: "DOC036", type: "Commercial Invoice", status: "approved", containerId: "CNT006", shipmentId: "SHP-2026-003", uploadedBy: "Mediterranean Harvest Ltd", uploadedAt: "2026-03-01 08:00", reviewStatus: "approved", reviewedBy: "Agent Muller", reviewedAt: "2026-03-03 09:00" },
  { id: "DOC037", type: "Packing List", status: "approved", containerId: "CNT006", shipmentId: "SHP-2026-003", uploadedBy: "Mediterranean Harvest Ltd", uploadedAt: "2026-03-01 08:05", reviewStatus: "approved", reviewedBy: "Agent Muller", reviewedAt: "2026-03-03 09:10" },
  { id: "DOC038", type: "Phytosanitary Certificate", status: "rejected", containerId: "CNT006", shipmentId: "SHP-2026-003", uploadedBy: "Mediterranean Harvest Ltd", uploadedAt: "2026-03-01 08:10", reviewStatus: "rejected", reviewedBy: "Agent Muller", reviewedAt: "2026-03-03 10:00", rejectionReason: "Phytosanitary certificate was issued for a different lot number. Must match the lot numbers on the packing list." },
  { id: "DOC039", type: "Bill of Lading", status: "approved", containerId: "CNT006", shipmentId: "SHP-2026-003", uploadedBy: "Mediterranean Harvest Ltd", uploadedAt: "2026-03-06 14:00", reviewStatus: "approved", reviewedBy: "Agent Muller", reviewedAt: "2026-03-07 08:00" },
  { id: "DOC040", type: "Certificate of Origin", status: "approved", containerId: "CNT006", shipmentId: "SHP-2026-003", uploadedBy: "Mediterranean Harvest Ltd", uploadedAt: "2026-03-01 08:20", reviewStatus: "approved", reviewedBy: "Agent Muller", reviewedAt: "2026-03-03 09:20" },
  { id: "DOC041", type: "Cooling Report", status: "uploaded", containerId: "CNT006", shipmentId: "SHP-2026-003", uploadedBy: "Mediterranean Harvest Ltd", uploadedAt: "2026-03-08 10:00" },
  { id: "DOC042", type: "Insurance", status: "approved", containerId: "CNT006", shipmentId: "SHP-2026-003", uploadedBy: "Mediterranean Harvest Ltd", uploadedAt: "2026-03-01 08:25", reviewStatus: "approved", reviewedBy: "Agent Muller", reviewedAt: "2026-03-03 09:25" },

  // --- CNT007 (SHP-2026-004) -- missing-documents ---
  { id: "DOC043", type: "Commercial Invoice", status: "uploaded", containerId: "CNT007", shipmentId: "SHP-2026-004", uploadedBy: "Pacific Produce Co", uploadedAt: "2026-02-10 08:00" },
  { id: "DOC044", type: "Packing List", status: "missing", containerId: "CNT007", shipmentId: "SHP-2026-004" },
  { id: "DOC045", type: "Phytosanitary Certificate", status: "missing", containerId: "CNT007", shipmentId: "SHP-2026-004" },
  { id: "DOC046", type: "Bill of Lading", status: "missing", containerId: "CNT007", shipmentId: "SHP-2026-004" },
  { id: "DOC047", type: "Certificate of Origin", status: "uploaded", containerId: "CNT007", shipmentId: "SHP-2026-004", uploadedBy: "Pacific Produce Co", uploadedAt: "2026-02-10 08:10" },
  { id: "DOC048", type: "Cooling Report", status: "missing", containerId: "CNT007", shipmentId: "SHP-2026-004" },
  { id: "DOC049", type: "Insurance", status: "missing", containerId: "CNT007", shipmentId: "SHP-2026-004" },

  // --- CNT008 (SHP-2026-004) -- missing-documents ---
  { id: "DOC050", type: "Commercial Invoice", status: "missing", containerId: "CNT008", shipmentId: "SHP-2026-004" },
  { id: "DOC051", type: "Packing List", status: "missing", containerId: "CNT008", shipmentId: "SHP-2026-004" },
  { id: "DOC052", type: "Phytosanitary Certificate", status: "missing", containerId: "CNT008", shipmentId: "SHP-2026-004" },
  { id: "DOC053", type: "Bill of Lading", status: "missing", containerId: "CNT008", shipmentId: "SHP-2026-004" },
  { id: "DOC054", type: "Certificate of Origin", status: "missing", containerId: "CNT008", shipmentId: "SHP-2026-004" },
  { id: "DOC055", type: "Cooling Report", status: "missing", containerId: "CNT008", shipmentId: "SHP-2026-004" },
  { id: "DOC056", type: "Insurance", status: "missing", containerId: "CNT008", shipmentId: "SHP-2026-004" },

  // --- CNT009 (SHP-2026-005) -- released ---
  { id: "DOC057", type: "Commercial Invoice", status: "approved", containerId: "CNT009", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:00", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:00" },
  { id: "DOC058", type: "Packing List", status: "approved", containerId: "CNT009", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:05", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:05" },
  { id: "DOC059", type: "Phytosanitary Certificate", status: "approved", containerId: "CNT009", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:10", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:10" },
  { id: "DOC060", type: "Bill of Lading", status: "approved", containerId: "CNT009", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-16 14:00", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-17 09:00" },
  { id: "DOC061", type: "Certificate of Origin", status: "approved", containerId: "CNT009", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:20", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:20" },
  { id: "DOC062", type: "Cooling Report", status: "approved", containerId: "CNT009", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-03-01 08:00", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-03-02 09:00" },
  { id: "DOC063", type: "Insurance", status: "approved", containerId: "CNT009", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:25", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:25" },

  // --- CNT010 (SHP-2026-005) -- released ---
  { id: "DOC064", type: "Commercial Invoice", status: "approved", containerId: "CNT010", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:30", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:30" },
  { id: "DOC065", type: "Packing List", status: "approved", containerId: "CNT010", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:35", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:35" },
  { id: "DOC066", type: "Phytosanitary Certificate", status: "approved", containerId: "CNT010", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:40", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:40" },
  { id: "DOC067", type: "Bill of Lading", status: "approved", containerId: "CNT010", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-02-16 14:05", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-17 09:05" },
  { id: "DOC068", type: "Certificate of Origin", status: "approved", containerId: "CNT010", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:50", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:50" },
  { id: "DOC069", type: "Cooling Report", status: "approved", containerId: "CNT010", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-03-01 08:05", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-03-02 09:05" },
  { id: "DOC070", type: "Insurance", status: "approved", containerId: "CNT010", shipmentId: "SHP-2026-005", uploadedBy: "FreshFruit Exports SA", uploadedAt: "2026-01-30 09:55", reviewStatus: "approved", reviewedBy: "Agent De Vries", reviewedAt: "2026-02-01 10:55" },
];

export const mockActivities: ActivityEvent[] = [
  { id: "ACT001", shipmentId: "SHP-2026-001", type: "created", description: "Shipment created", timestamp: "2026-02-10 08:00", user: "EuroFresh Imports GmbH" },
  { id: "ACT002", shipmentId: "SHP-2026-001", containerId: "CNT001", type: "container-added", description: "Container MSCU-1234567 added", timestamp: "2026-02-10 08:30", user: "System" },
  { id: "ACT003", shipmentId: "SHP-2026-001", containerId: "CNT002", type: "container-added", description: "Container MSCU-1234568 added", timestamp: "2026-02-10 08:35", user: "System" },
  { id: "ACT004", shipmentId: "SHP-2026-001", containerId: "CNT001", type: "docs-uploaded", description: "Commercial Invoice, Packing List, Insurance uploaded", timestamp: "2026-02-12 09:30", user: "FreshFruit Exports SA" },
  { id: "ACT005", shipmentId: "SHP-2026-001", containerId: "CNT001", type: "docs-approved", description: "Commercial Invoice, Packing List, Insurance approved", timestamp: "2026-02-14 11:00", user: "Agent De Vries" },
  { id: "ACT006", shipmentId: "SHP-2026-001", containerId: "CNT002", type: "doc-rejected", description: "Packing List rejected - quantity mismatch", timestamp: "2026-02-14 11:20", user: "Agent De Vries" },
  { id: "ACT007", shipmentId: "SHP-2026-001", type: "sailed", description: "Vessel MSC Paloma sailed from Cape Town", timestamp: "2026-02-25 06:00", user: "System" },
  { id: "ACT008", shipmentId: "SHP-2026-001", containerId: "CNT001", type: "docs-uploaded", description: "Bill of Lading uploaded", timestamp: "2026-02-26 10:00", user: "FreshFruit Exports SA" },
  { id: "ACT009", shipmentId: "SHP-2026-001", containerId: "CNT002", type: "doc-rejected", description: "Certificate of Origin rejected - expired", timestamp: "2026-03-04 14:30", user: "Agent De Vries" },
  { id: "ACT010", shipmentId: "SHP-2026-002", type: "created", description: "Shipment created", timestamp: "2026-02-15 10:00", user: "EuroFresh Imports GmbH" },
  { id: "ACT011", shipmentId: "SHP-2026-003", type: "created", description: "Shipment created", timestamp: "2026-02-28 09:00", user: "Atlantic Fresh Trading BV" },
  { id: "ACT012", shipmentId: "SHP-2026-003", containerId: "CNT006", type: "doc-rejected", description: "Phytosanitary Certificate rejected - wrong lot number", timestamp: "2026-03-03 10:00", user: "Agent Muller" },
  { id: "ACT013", shipmentId: "SHP-2026-005", type: "clearance", description: "All containers released from customs", timestamp: "2026-03-08 14:00", user: "Agent De Vries" },
];

export const mockAccounts: Account[] = [
  { id: "ACC001", name: "FreshFruit Exports SA", type: "supplier", totalInvoices: 5, totalAmount: 15000, paidAmount: 10000, remainingBalance: 5000, lastPaymentDate: "2026-02-28" },
  { id: "ACC002", name: "AgroVerde Chile SpA", type: "supplier", totalInvoices: 3, totalAmount: 9000, paidAmount: 6000, remainingBalance: 3000, lastPaymentDate: "2026-02-25" },
  { id: "ACC003", name: "Mediterranean Harvest Ltd", type: "supplier", totalInvoices: 4, totalAmount: 12000, paidAmount: 8000, remainingBalance: 4000, lastPaymentDate: "2026-02-20" },
  { id: "ACC004", name: "Pacific Produce Co", type: "supplier", totalInvoices: 2, totalAmount: 6000, paidAmount: 4000, remainingBalance: 2000, lastPaymentDate: "2026-02-15" },
  { id: "ACC005", name: "EuroFresh Imports GmbH", type: "importer", totalInvoices: 7, totalAmount: 21000, paidAmount: 14000, remainingBalance: 7000, lastPaymentDate: "2026-02-10" },
  { id: "ACC006", name: "Atlantic Fresh Trading BV", type: "importer", totalInvoices: 6, totalAmount: 18000, paidAmount: 12000, remainingBalance: 6000, lastPaymentDate: "2026-02-05" },
];

export const mockInvoices: Invoice[] = [
  { id: "INV001", accountId: "ACC001", invoiceNumber: "INV-2026-001", date: "2026-01-30", relatedShipment: "SHP-2026-005", relatedContainer: "CNT009", amount: 5000, paidAmount: 3000, remainingAmount: 2000, status: "partially-paid", swiftDocument: "SWIFT-DOC-001" },
  { id: "INV002", accountId: "ACC001", invoiceNumber: "INV-2026-002", date: "2026-02-15", relatedShipment: "SHP-2026-005", relatedContainer: "CNT010", amount: 5000, paidAmount: 5000, remainingAmount: 0, status: "paid", swiftDocument: "SWIFT-DOC-002" },
  { id: "INV003", accountId: "ACC002", invoiceNumber: "INV-2026-003", date: "2026-02-20", relatedShipment: "SHP-2026-002", relatedContainer: "CNT003", amount: 3000, paidAmount: 0, remainingAmount: 3000, status: "unpaid", swiftDocument: "SWIFT-DOC-003" },
  { id: "INV004", accountId: "ACC002", invoiceNumber: "INV-2026-004", date: "2026-02-25", relatedShipment: "SHP-2026-002", relatedContainer: "CNT004", amount: 3000, paidAmount: 0, remainingAmount: 3000, status: "unpaid", swiftDocument: "SWIFT-DOC-004" },
  { id: "INV005", accountId: "ACC003", invoiceNumber: "INV-2026-005", date: "2026-03-01", relatedShipment: "SHP-2026-003", relatedContainer: "CNT006", amount: 4000, paidAmount: 0, remainingAmount: 4000, status: "unpaid", swiftDocument: "SWIFT-DOC-005" },
  { id: "INV006", accountId: "ACC004", invoiceNumber: "INV-2026-006", date: "2026-03-05", relatedShipment: "SHP-2026-004", relatedContainer: "CNT007", amount: 2000, paidAmount: 0, remainingAmount: 2000, status: "unpaid", swiftDocument: "SWIFT-DOC-006" },
  { id: "INV007", accountId: "ACC004", invoiceNumber: "INV-2026-007", date: "2026-03-10", relatedShipment: "SHP-2026-004", relatedContainer: "CNT008", amount: 2000, paidAmount: 0, remainingAmount: 2000, status: "unpaid", swiftDocument: "SWIFT-DOC-007" },
  { id: "INV008", accountId: "ACC005", invoiceNumber: "INV-2026-008", date: "2026-03-15", relatedShipment: "SHP-2026-001", relatedContainer: "CNT001", amount: 5000, paidAmount: 0, remainingAmount: 5000, status: "unpaid", swiftDocument: "SWIFT-DOC-008" },
  { id: "INV009", accountId: "ACC005", invoiceNumber: "INV-2026-009", date: "2026-03-20", relatedShipment: "SHP-2026-001", relatedContainer: "CNT002", amount: 5000, paidAmount: 0, remainingAmount: 5000, status: "unpaid", swiftDocument: "SWIFT-DOC-009" },
  { id: "INV010", accountId: "ACC006", invoiceNumber: "INV-2026-010", date: "2026-03-25", relatedShipment: "SHP-2026-002", relatedContainer: "CNT005", amount: 3000, paidAmount: 0, remainingAmount: 3000, status: "unpaid", swiftDocument: "SWIFT-DOC-010" },
];

export const mockClaims: Claim[] = [
  { id: "CLM001", containerId: "CNT001", containerNumber: "MSCU-1234567", supplierId: "SUP001", supplierName: "FreshFruit Exports SA", productId: "PRD001", productName: "Citrus Fruit (Oranges, Lemons)", claimType: "damage", description: "Container MSCU-1234567 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "open", createdAt: "2026-03-05 10:00", messages: [
    { id: "MSG001", sender: "EuroFresh Imports GmbH", senderRole: "importer", text: "Container MSCU-1234567 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 10:00" },
    { id: "MSG002", sender: "FreshFruit Exports SA", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 10:10" },
  ] },
  { id: "CLM002", containerId: "CNT002", containerNumber: "MSCU-1234568", supplierId: "SUP001", supplierName: "FreshFruit Exports SA", productId: "PRD001", productName: "Citrus Fruit (Oranges, Lemons)", claimType: "damage", description: "Container MSCU-1234568 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "under-review", createdAt: "2026-03-05 10:20", messages: [
    { id: "MSG003", sender: "EuroFresh Imports GmbH", senderRole: "importer", text: "Container MSCU-1234568 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 10:20" },
    { id: "MSG004", sender: "FreshFruit Exports SA", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 10:30" },
  ] },
  { id: "CLM003", containerId: "CNT003", containerNumber: "CMAU-9876543", supplierId: "SUP002", supplierName: "AgroVerde Chile SpA", productId: "PRD002", productName: "Table Grapes", claimType: "damage", description: "Container CMAU-9876543 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "negotiation", createdAt: "2026-03-05 10:40", messages: [
    { id: "MSG005", sender: "EuroFresh Imports GmbH", senderRole: "importer", text: "Container CMAU-9876543 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 10:40" },
    { id: "MSG006", sender: "AgroVerde Chile SpA", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 10:50" },
  ] },
  { id: "CLM004", containerId: "CNT004", containerNumber: "CMAU-9876544", supplierId: "SUP002", supplierName: "AgroVerde Chile SpA", productId: "PRD002", productName: "Table Grapes", claimType: "damage", description: "Container CMAU-9876544 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "resolved", createdAt: "2026-03-05 11:00", messages: [
    { id: "MSG007", sender: "EuroFresh Imports GmbH", senderRole: "importer", text: "Container CMAU-9876544 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 11:00" },
    { id: "MSG008", sender: "AgroVerde Chile SpA", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 11:10" },
  ] },
  { id: "CLM005", containerId: "CNT005", containerNumber: "CMAU-9876545", supplierId: "SUP002", supplierName: "AgroVerde Chile SpA", productId: "PRD002", productName: "Table Grapes", claimType: "damage", description: "Container CMAU-9876545 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "closed", createdAt: "2026-03-05 11:20", messages: [
    { id: "MSG009", sender: "EuroFresh Imports GmbH", senderRole: "importer", text: "Container CMAU-9876545 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 11:20" },
    { id: "MSG010", sender: "AgroVerde Chile SpA", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 11:30" },
  ] },
  { id: "CLM006", containerId: "CNT006", containerNumber: "MSKU-5551234", supplierId: "SUP003", supplierName: "Mediterranean Harvest Ltd", productId: "PRD003", productName: "Avocados", claimType: "damage", description: "Container MSKU-5551234 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "open", createdAt: "2026-03-05 11:40", messages: [
    { id: "MSG011", sender: "Atlantic Fresh Trading BV", senderRole: "importer", text: "Container MSKU-5551234 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 11:40" },
    { id: "MSG012", sender: "Mediterranean Harvest Ltd", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 11:50" },
  ] },
  { id: "CLM007", containerId: "CNT007", containerNumber: "EGHU-7778889", supplierId: "SUP004", supplierName: "Pacific Produce Co", productId: "PRD004", productName: "Kiwifruit", claimType: "damage", description: "Container EGHU-7778889 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "under-review", createdAt: "2026-03-05 12:00", messages: [
    { id: "MSG013", sender: "Atlantic Fresh Trading BV", senderRole: "importer", text: "Container EGHU-7778889 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 12:00" },
    { id: "MSG014", sender: "Pacific Produce Co", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 12:10" },
  ] },
  { id: "CLM008", containerId: "CNT008", containerNumber: "EGHU-7778890", supplierId: "SUP004", supplierName: "Pacific Produce Co", productId: "PRD004", productName: "Kiwifruit", claimType: "damage", description: "Container EGHU-7778890 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "negotiation", createdAt: "2026-03-05 12:20", messages: [
    { id: "MSG015", sender: "Atlantic Fresh Trading BV", senderRole: "importer", text: "Container EGHU-7778890 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 12:20" },
    { id: "MSG016", sender: "Pacific Produce Co", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 12:30" },
  ] },
  { id: "CLM009", containerId: "CNT009", containerNumber: "MSCU-3334445", supplierId: "SUP001", supplierName: "FreshFruit Exports SA", productId: "PRD001", productName: "Citrus Fruit (Oranges, Lemons)", claimType: "damage", description: "Container MSCU-3334445 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "resolved", createdAt: "2026-03-05 12:40", messages: [
    { id: "MSG017", sender: "EuroFresh Imports GmbH", senderRole: "importer", text: "Container MSCU-3334445 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 12:40" },
    { id: "MSG018", sender: "FreshFruit Exports SA", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 12:50" },
  ] },
  { id: "CLM010", containerId: "CNT010", containerNumber: "MSCU-3334446", supplierId: "SUP001", supplierName: "FreshFruit Exports SA", productId: "PRD001", productName: "Citrus Fruit (Oranges, Lemons)", claimType: "damage", description: "Container MSCU-3334446 arrived with damaged fruit. Please provide a replacement.", amount: 1000, status: "closed", createdAt: "2026-03-05 13:00", messages: [
    { id: "MSG019", sender: "EuroFresh Imports GmbH", senderRole: "importer", text: "Container MSCU-3334446 arrived with damaged fruit. Please provide a replacement.", timestamp: "2026-03-05 13:00" },
    { id: "MSG020", sender: "FreshFruit Exports SA", senderRole: "supplier", text: "We are investigating the issue and will provide a replacement as soon as possible.", timestamp: "2026-03-05 13:10" },
  ] },
];

export const mockImportLicenses: ImportLicense[] = [
  { id: "LIC001", supplierId: "SUP001", supplierName: "FreshFruit Exports SA", licenseNumber: "LIC-2026-001", fileName: "license_2026_001.pdf", issueDate: "2026-01-01", expirationDate: "2026-12-31" },
  { id: "LIC002", supplierId: "SUP002", supplierName: "AgroVerde Chile SpA", licenseNumber: "LIC-2026-002", fileName: "license_2026_002.pdf", issueDate: "2026-01-01", expirationDate: "2026-12-31" },
  { id: "LIC003", supplierId: "SUP003", supplierName: "Mediterranean Harvest Ltd", licenseNumber: "LIC-2026-003", fileName: "license_2026_003.pdf", issueDate: "2026-01-01", expirationDate: "2026-12-31" },
  { id: "LIC004", supplierId: "SUP004", supplierName: "Pacific Produce Co", licenseNumber: "LIC-2026-004", fileName: "license_2026_004.pdf", issueDate: "2026-01-01", expirationDate: "2026-12-31" },
];

export const mockCargoPhotos: CargoPhoto[] = [
  { id: "PHO001", containerId: "CNT001", url: "https://example.com/photos/photo_2026_001.jpg", type: "image", comment: "Container MSCU-1234567 arrived in good condition.", uploadedAt: "2026-03-05 10:00", uploadedBy: "Agent De Vries" },
  { id: "PHO002", containerId: "CNT002", url: "https://example.com/photos/photo_2026_002.jpg", type: "image", comment: "Container MSCU-1234568 arrived with damaged fruit.", uploadedAt: "2026-03-05 10:10", uploadedBy: "Agent De Vries" },
  { id: "PHO003", containerId: "CNT003", url: "https://example.com/photos/photo_2026_003.jpg", type: "image", comment: "Container CMAU-9876543 arrived in good condition.", uploadedAt: "2026-03-05 10:20", uploadedBy: "Agent De Vries" },
  { id: "PHO004", containerId: "CNT004", url: "https://example.com/photos/photo_2026_004.jpg", type: "image", comment: "Container CMAU-9876544 arrived in good condition.", uploadedAt: "2026-03-05 10:30", uploadedBy: "Agent De Vries" },
  { id: "PHO005", containerId: "CNT005", url: "https://example.com/photos/photo_2026_005.jpg", type: "image", comment: "Container CMAU-9876545 arrived in good condition.", uploadedAt: "2026-03-05 10:40", uploadedBy: "Agent De Vries" },
  { id: "PHO006", containerId: "CNT006", url: "https://example.com/photos/photo_2026_006.jpg", type: "image", comment: "Container MSKU-5551234 arrived with damaged fruit.", uploadedAt: "2026-03-05 10:50", uploadedBy: "Agent Muller" },
  { id: "PHO007", containerId: "CNT007", url: "https://example.com/photos/photo_2026_007.jpg", type: "image", comment: "Container EGHU-7778889 arrived in good condition.", uploadedAt: "2026-03-05 11:00", uploadedBy: "Agent Muller" },
  { id: "PHO008", containerId: "CNT008", url: "https://example.com/photos/photo_2026_008.jpg", type: "image", comment: "Container EGHU-7778890 arrived in good condition.", uploadedAt: "2026-03-05 11:10", uploadedBy: "Agent Muller" },
  { id: "PHO009", containerId: "CNT009", url: "https://example.com/photos/photo_2026_009.jpg", type: "image", comment: "Container MSCU-3334445 arrived in good condition.", uploadedAt: "2026-03-05 11:20", uploadedBy: "Agent De Vries" },
  { id: "PHO010", containerId: "CNT010", url: "https://example.com/photos/photo_2026_010.jpg", type: "image", comment: "Container MSCU-3334446 arrived in good condition.", uploadedAt: "2026-03-05 11:30", uploadedBy: "Agent De Vries" },
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function getSupplier(id: string) {
  return mockSuppliers.find((s) => s.id === id);
}
export function getProduct(id: string) {
  return mockProducts.find((p) => p.id === id);
}
export function getImporter(id: string) {
  return mockImporters.find((i) => i.id === id);
}
export function getShipment(id: string) {
  return mockShipments.find((s) => s.id === id);
}
export function getContainersForShipment(shipmentId: string) {
  return mockContainers.filter((c) => c.shipmentId === shipmentId);
}
export function getDocumentsForContainer(containerId: string) {
  return mockDocuments.filter((d) => d.containerId === containerId);
}
export function getDocumentsForShipment(shipmentId: string) {
  return mockDocuments.filter((d) => d.shipmentId === shipmentId);
}
export function getContainer(id: string) {
  return mockContainers.find((c) => c.id === id);
}
export function getActivitiesForShipment(shipmentId: string) {
  return mockActivities.filter((a) => a.shipmentId === shipmentId);
}

export function getAccountsForRole(role: "importer" | "supplier" | "customs-agent"): Account[] {
  if (role === "importer") return mockAccounts.filter((a) => a.type === "supplier");
  if (role === "supplier") return mockAccounts.filter((a) => a.type === "importer");
  return mockAccounts;
}

export function getAccount(id: string) {
  return mockAccounts.find((a) => a.id === id);
}

export function getInvoicesForAccount(accountId: string) {
  return mockInvoices.filter((i) => i.accountId === accountId);
}

export function getClaim(id: string) {
  return mockClaims.find((c) => c.id === id);
}

export function getCargoPhotosForContainer(containerId: string) {
  return mockCargoPhotos.filter((p) => p.containerId === containerId);
}

export function getLicenseStatus(expirationDate: string): LicenseStatus {
  const days = daysBetween(expirationDate);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring-soon";
  return "valid";
}

export function getDocStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case "missing": return "Missing";
    case "uploaded": return "Uploaded";
    case "under-review": return "Under Review";
    case "approved": return "Approved";
    case "rejected": return "Rejected";
  }
}

export function getClearanceStatusLabel(status: ClearanceStatus): string {
  switch (status) {
    case "missing-documents": return "Missing Documents";
    case "waiting-for-review": return "Waiting for Customs Review";
    case "rejected-action-required": return "Rejected - Action Required";
    case "ready-for-clearance": return "Ready for Clearance";
    case "in-clearance": return "In Clearance Process";
    case "released": return "Released";
  }
}

export function getShipmentStatusLabel(status: ShipmentStatus): string {
  switch (status) {
    case "in-transit": return "In Transit";
    case "at-port": return "At Port";
    case "customs-hold": return "Customs Hold";
    case "cleared": return "Cleared";
    case "delivered": return "Delivered";
  }
}

export function daysBetween(dateStr: string): number {
  const today = new Date("2026-03-09");
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}