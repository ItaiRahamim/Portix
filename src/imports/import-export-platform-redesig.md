Redesign the Importer, Supplier and Customs Agent dashboards for the Import/Export platform.

The platform must be CONTAINER-CENTRIC.

All operational tables should be based on CONTAINERS, not shipments.

Each row must represent ONE CONTAINER.

------------------------------------------------

IMPORTER DASHBOARD – CONTAINER CONTROL

Replace the shipment table with a container table.

Columns:

Container Number
Shipment ID
Supplier
Product
Vessel
ETD
ETA
Container Status
Documents Status
Customs Review Status
Clearance Status
Alerts
Action

Container Status options:

Documents Missing
Waiting Customs Review
Rejected Documents
Ready for Clearance
In Clearance
Released
Claim Open


Importer KPI cards:

Active Containers
Waiting for Documents
Waiting Customs Review
Rejected Containers
Ready for Clearance


Clicking a container opens the Container Details page.


------------------------------------------------

CONTAINER DETAILS PAGE

Header:

Container Number
Shipment ID
Importer
Supplier
Product
Vessel
ETD
ETA
Port of Loading
Port of Destination

Sections:

Container Clearance Status

Documents Checklist Table

Columns:

Document Type
Upload Status
Upload Date
Review Status
Rejection Reason
File
Action

Document statuses:

Missing
Uploaded
Under Review
Approved
Rejected


------------------------------------------------

ACCOUNT MANAGEMENT MODULE

Add a new section in the navigation for ALL roles:

"Accounts"

Users can see their customers or suppliers and the financial status with each.

Importer view:
List of suppliers

Columns:

Supplier Name
Total Invoices
Total Amount
Paid Amount
Remaining Balance
Last Payment Date
Action


Supplier view:
List of importers (clients)

Columns:

Importer Name
Total Invoices
Total Amount
Paid Amount
Remaining Balance
Last Payment Date
Action


Customs Agent view:
List of clients

Columns:

Client Name
Total Invoices
Total Amount
Paid Amount
Remaining Balance
Last Payment Date
Action


------------------------------------------------

INVOICE MANAGEMENT

Inside each account page:

Invoices Table

Columns:

Invoice Number
Date
Related Shipment / Container
Amount
Paid Amount
Remaining Amount
Status
SWIFT Document
Action

Invoice Status:

Unpaid
Partially Paid
Paid

Actions:

Upload Invoice
Upload SWIFT payment confirmation
View Invoice
Download Invoice


------------------------------------------------

CLAIMS MANAGEMENT

Add a Claims section.

Importers can open claims related to containers.

Claim fields:

Container Number
Supplier
Product
Claim Type
Claim Description
Claim Amount
Status

Claim Status:

Open
Under Review
Negotiation
Resolved
Closed


Claim thread section:

Messages between importer and supplier.

Allow uploading:

Images
Videos
Documents


------------------------------------------------

SUPPLIER CARGO PHOTOS

Suppliers must have an option to upload cargo photos BEFORE loading the container.

Add section in Container Details:

"Pre-Loading Cargo Photos"

Fields:

Upload Images
Upload Videos
Comments

These photos should be visible to the importer.


------------------------------------------------

IMPORT LICENSE MANAGEMENT

Importers must be able to upload import licenses per supplier.

Add a "Licenses" section.

Fields:

Supplier
License Number
Upload License File
Issue Date
Expiration Date

The system must automatically display:

Days Remaining Until Expiration

Status indicators:

Valid
Expiring Soon
Expired


------------------------------------------------

GOAL OF THE DESIGN

The platform must allow importers, suppliers and customs agents to:

Manage containers
Manage documents
Track customs approvals
Track financial balances between companies
Handle claims with images and videos
Upload cargo photos before loading
Manage import licenses and expiration dates

The interface must focus on operational clarity and container-level management.