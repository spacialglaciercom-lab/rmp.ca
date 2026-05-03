## 2025-05-15 - [PostGIS GiST Indexes in Drizzle]
**Learning:** Even if memory suggests spatial columns must have GiST indexes, they may be missing in newly added tables or complex schema definitions. Missing these indexes leads to full table scans on ST_DWithin and ST_Intersects, which degrades performance as the dataset grows.
**Action:** Always audit the Drizzle schema for 'geography' or 'geometry' types and ensure a corresponding index using '.using("gist", ...)' is defined.
