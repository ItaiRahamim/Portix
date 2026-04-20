Create a functional wireframe design for a web platform that manages international import/export shipments and documents.

The platform has three user roles:

1. Importer
2. Supplier
3. Customs Agent

Focus on functionality and dashboards, not visual styling.

The system manages shipments, containers, documents, and customs document approval before clearance.

Important business rule:
A container can only be marked "Ready for Clearance" AFTER all required documents are uploaded AND approved by the customs agent.

If a customs agent rejects a document, they MUST provide a mandatory free-text rejection reason.

Documents have the following statuses:
- Missing
- Uploaded
- Under Review
- Approved
- Rejected

Container clearance statuses:
- Missing Documents
- Waiting for Customs Review
- Rejected Documents – Action Required
- Ready for Clearance
- In Clearance Process
- Released


----------------------------------------

MAIN ENTITIES IN THE SYSTEM

Shipments
Containers
Documents
Suppliers
Products
Customs Review
Tasks


----------------------------------------

SCREEN 1: SHIPMENTS LIST

Create separate versions for:
Importer
Supplier
Customs Agent

Importer view columns:
- Shipment ID
- Supplier
- Product
- Number of Containers
- Vessel
- ETD
- ETA
- Shipment Status
- Documents Progress
- Customs Review Status
- Clearance Readiness
- Alerts
- Action

Importer filters:
Supplier
Product
ETA range
Missing documents
Customs review status

Importer top KPIs:
Active Shipments
Containers Waiting for Documents
Containers Waiting for Customs Review
Containers Rejected
Ready for Clearance


Supplier view columns:
- Shipment ID
- Importer
- Product
- Containers
- Required Documents
- Uploaded Documents
- Customs Review Status
- Rejected Documents Count
- Next Action

Supplier actions:
Upload documents
Replace rejected document
View rejection notes


Customs Agent view columns:
- Shipment ID
- Importer
- Supplier
- Containers
- Documents Completion
- Review Status
- Rejected Documents
- Pending Review Since
- Clearance Readiness
- Action

Customs KPIs:
Shipments Awaiting Review
Containers Pending Review
Rejected Documents
Ready for Clearance


----------------------------------------

SCREEN 2: SHIPMENT DETAILS

Header information:
Shipment ID
Supplier
Importer
Product
Origin Country
Destination Port
Vessel Name
ETD
ETA
Shipment Status
Clearance Readiness Status

Sections:

Shipment Summary Cards
- Containers Count
- Documents Uploaded
- Missing Documents
- Documents Under Review
- Rejected Documents
- Approved Documents

Containers Table:
- Container Number
- Container Type
- Temperature
- ETA
- Documents Status
- Customs Review Status
- Clearance Status
- Action

Documents Overview:
List all required document types:
Commercial Invoice
Packing List
Phytosanitary Certificate
Bill of Lading
Certificate of Origin
Cooling Report
Insurance

For each document show:
Upload Status
Review Status
Uploaded By
Upload Date
Rejection Reason if exists


Customs Review Summary:
Total Required Documents
Uploaded
Approved
Rejected
Pending Review

Activity Timeline:
Shipment created
Container added
Documents uploaded
Customs review started
Document rejected
Corrected document uploaded
Documents approved
Ready for clearance


----------------------------------------

SCREEN 3: CONTAINER PAGE

Header information:
Container Number
Shipment ID
Supplier
Product
Vessel
ETD
ETA
Reefer Temperature
Port of Loading
Port of Destination

Clearance Status Card:
- Missing Documents
- Waiting for Review
- Rejected Documents
- Ready for Clearance
- In Clearance
- Released

Documents Table:
- Document Type
- Status
- Uploaded By
- Upload Date
- Review Status
- Rejection Reason
- File Preview

Review Tracker:
Documents Approved / Total
Rejected Documents
Pending Review

Logistics Timeline:
Container created
Loaded
Sailed
Transshipment
Arrived
Docs approved
In clearance
Released


----------------------------------------

SCREEN 4: DOCUMENT UPLOAD

Fields:
Shipment ID
Container Number
Document Type
File Upload
Document Number
Issue Date
Supplier
Notes

Validation rules:
Document type required
File required
Shipment required

After upload:
Document status becomes "Uploaded – Waiting for Customs Review"


Supplier functionality:
Upload missing document
Replace rejected document
View rejection notes


Customs Agent optional functionality:
Upload customs related document
Attach additional notes


----------------------------------------

SCREEN 5: MISSING DOCUMENTS DASHBOARD

Create versions for each role.

Importer dashboard KPIs:
Total Missing Documents
Containers Missing Critical Docs
Containers Waiting for Review
Containers Rejected
Containers Ready for Clearance

Importer table columns:
Shipment ID
Container Number
Supplier
Product
Missing Documents
Rejected Documents
Pending Review Documents
ETA
Days to Arrival
Next Action


Supplier dashboard KPIs:
Missing Documents
Rejected Documents
Documents Awaiting Re-upload
Urgent Shipments

Supplier table columns:
Shipment ID
Container
Required Document
Status
Rejection Reason
Due Date
Action


Customs Agent dashboard KPIs:
Containers Blocked by Missing Docs
Containers Blocked by Pending Review
Containers Blocked by Rejected Docs
Containers Ready for Clearance

Customs Agent table columns:
Shipment ID
Container
Importer
Supplier
Missing Docs Count
Pending Review Count
Rejected Docs Count
Clearance Readiness
Action


----------------------------------------

REJECTION FLOW

Create a modal for customs agent:

Reject Document Modal

Fields:
Document Name
Container Number
Rejection Reason (mandatory free text)
Internal Note (optional)

Buttons:
Cancel
Reject Document

Rules:
Cannot reject without reason
Rejected document status becomes "Rejected"
Container cannot be marked ready for clearance until corrected
Supplier can upload corrected version