Redesign the Supplier and Customs Agent dashboards in the Import/Export platform.

The current design is shipment-based, but this is incorrect.

The system must be CONTAINER-CENTRIC.

Each row in the table must represent ONE CONTAINER, not a shipment.

The operational unit in the platform is the container, because documents and customs clearance are handled per container.


-------------------------------------

SUPPLIER DASHBOARD – CONTAINER LIST

Create a table where each row represents one container.

Columns:

Container Number
Shipment ID
Importer
Product
ETA
Required Documents
Uploaded Documents
Review Status
Rejected Documents
Next Action

Example actions:
View Container
Upload Missing Documents
Replace Rejected Documents

Add KPI cards at the top:

Missing Documents
Rejected Documents
Awaiting Re-upload
Urgent Containers

Clicking a container row must open a CONTAINER DETAILS PAGE.


-------------------------------------

CUSTOMS AGENT DASHBOARD – CONTAINER REVIEW LIST

Create a container-based review dashboard.

Each row represents one container waiting for review or approval.

Columns:

Container Number
Shipment ID
Importer
Supplier
Product
ETA
Uploaded Documents
Pending Review
Rejected Documents
Clearance Status
Action

Possible actions:

Review Container
Approve Documents
Reject Document

Add KPI cards at the top:

Containers Awaiting Review
Documents Pending Review
Rejected Documents
Containers Ready for Clearance


-------------------------------------

CONTAINER DETAILS PAGE (for both Supplier and Customs Agent)

When clicking a container, open a Container Details screen.

Header information:

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
Clearance Status

Add a "Clearance Progress" summary card:

Total Required Documents
Uploaded
Approved
Rejected
Pending Review
Missing


-------------------------------------

DOCUMENT CHECKLIST TABLE

Show all required documents for the container.

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


-------------------------------------

SUPPLIER ACTIONS

Upload document
Replace rejected document
View document


-------------------------------------

CUSTOMS AGENT REVIEW ACTIONS

Approve document
Reject document

If rejecting a document:

Open a Reject Document modal.

Fields:

Document Name
Container Number
Rejection Reason (mandatory free text)
Internal Note (optional)

Buttons:

Cancel
Reject Document


Rules:

A document cannot be rejected without a rejection reason.

If any document is rejected, the container status becomes:

"Rejected Documents – Action Required"

A container can only become:

"Ready for Clearance"

when ALL required documents are uploaded AND approved.


-------------------------------------

GOAL OF THE DESIGN

The dashboards must provide operational clarity so that:

Suppliers immediately see which containers require document uploads or corrections.

Customs agents can quickly review container documents and approve or reject them.

Container Details must clearly display the full document checklist and review status for each document.