-- e_season: Sri Lanka Railways season ticket prototype (mock data only)
-- MySQL 8.0.16+ (needed for UUID() defaults and enforced CHECK constraints)

CREATE DATABASE IF NOT EXISTS e_season
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE e_season;

SET FOREIGN_KEY_CHECKS = 0;

-- ========== INSTITUTIONS (government) ==========
CREATE TABLE institutions (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  name           VARCHAR(255) NOT NULL,
  org_auth_code  VARCHAR(100) NOT NULL,   -- Organisation Authentication Code (hash in production)
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  registered_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_institutions_name (name),
  UNIQUE KEY uq_institutions_code (org_auth_code)
) ENGINE=InnoDB;

-- ========== STATIONS ==========
CREATE TABLE stations (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()),
  name                  VARCHAR(150) NOT NULL,
  line                  VARCHAR(100),               -- Main, Coastal, Kelani Valley, ...
  has_seat_reservation  TINYINT(1)   NOT NULL DEFAULT 0,   -- can verify accounts
  PRIMARY KEY (id),
  UNIQUE KEY uq_stations_name (name)
) ENGINE=InnoDB;

-- ========== STAFF / ADMIN ==========
CREATE TABLE staff_users (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  full_name       VARCHAR(255) NOT NULL,
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('station_staff','institution_officer','admin') NOT NULL,
  station_id      CHAR(36)     NULL,              -- for station_staff
  institution_id  CHAR(36)     NULL,              -- for institution_officer
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_email (email),
  CONSTRAINT fk_staff_station     FOREIGN KEY (station_id)     REFERENCES stations(id),
  CONSTRAINT fk_staff_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
  CONSTRAINT chk_staff_officer_inst
    CHECK (role <> 'institution_officer' OR institution_id IS NOT NULL)
) ENGINE=InnoDB;

-- ========== PASSENGERS ==========
CREATE TABLE users (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  passenger_type       ENUM('government','private') NOT NULL,
  full_name            VARCHAR(255) NOT NULL,
  nic_hash             VARCHAR(255) NOT NULL,     -- hash of NIC, never the raw number
  nic_last4            CHAR(4),                   -- optional, for display/support
  phone                VARCHAR(15)  NOT NULL,     -- normalised +947XXXXXXXX
  password_hash        VARCHAR(255) NULL,         -- bcrypt; NULL only for accounts made before passwords existed
  email                VARCHAR(255),
  date_of_birth        DATE,
  address              TEXT,
  preferred_language   ENUM('en','si','ta') NOT NULL DEFAULT 'en',
  verification_status  ENUM('pending_institution_approval','pending_verification',
                            'verified','rejected') NOT NULL,
  rejection_reason     TEXT,
  consent_given_at     DATETIME     NOT NULL,     -- data-collection consent
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           DATETIME     NULL,         -- soft delete / account deletion
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_nic   (nic_hash),
  UNIQUE KEY uq_users_phone (phone),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT chk_users_name CHECK (CHAR_LENGTH(full_name) >= 3),
  KEY idx_users_status (verification_status)
) ENGINE=InnoDB;

CREATE TABLE gov_profiles (
  user_id         CHAR(36)     NOT NULL,
  institution_id  CHAR(36)     NOT NULL,
  employee_no     VARCHAR(100),
  designation     VARCHAR(150),
  approved_by     CHAR(36)     NULL,
  approved_at     DATETIME     NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_gov_inst_emp (institution_id, employee_no),
  KEY idx_gov_institution (institution_id),
  CONSTRAINT fk_gov_user        FOREIGN KEY (user_id)        REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_gov_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
  CONSTRAINT fk_gov_approved_by FOREIGN KEY (approved_by)    REFERENCES staff_users(id)
) ENGINE=InnoDB;

CREATE TABLE private_profiles (
  user_id        CHAR(36)     NOT NULL,
  employer_name  VARCHAR(255),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_private_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE verification_docs (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id      CHAR(36)     NOT NULL,
  doc_type     ENUM('photo','nic_front','nic_back','residence_proof') NOT NULL,
  file_url     VARCHAR(1024) NOT NULL,
  uploaded_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  purge_after  DATETIME     NULL,                 -- delete NIC images once verified
  PRIMARY KEY (id),
  UNIQUE KEY uq_docs_user_type (user_id, doc_type),
  CONSTRAINT fk_docs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE verification_reviews (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id      CHAR(36)     NOT NULL,
  reviewer_id  CHAR(36)     NOT NULL,
  decision     ENUM('approved','rejected') NOT NULL,
  reason       TEXT,
  reviewed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_reviews_user     FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES staff_users(id)
) ENGINE=InnoDB;

-- ========== FARES & WINDOWS ==========
CREATE TABLE fares (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  from_station_id  CHAR(36)      NOT NULL,
  to_station_id    CHAR(36)      NOT NULL,
  ticket_class     ENUM('first','second','third') NOT NULL,
  period           ENUM('weekly','monthly','quarterly') NOT NULL,
  passenger_type   ENUM('government','private') NULL,   -- NULL = applies to both
  amount_lkr       DECIMAL(10,2) NOT NULL,
  effective_from   DATE          NOT NULL DEFAULT (CURRENT_DATE),
  PRIMARY KEY (id),
  -- Note: MySQL allows duplicate rows when passenger_type is NULL; check this in app code
  UNIQUE KEY uq_fares (from_station_id, to_station_id, ticket_class, period,
                       passenger_type, effective_from),
  CONSTRAINT fk_fares_from FOREIGN KEY (from_station_id) REFERENCES stations(id),
  CONSTRAINT fk_fares_to   FOREIGN KEY (to_station_id)   REFERENCES stations(id),
  CONSTRAINT chk_fares_stations CHECK (from_station_id <> to_station_id),
  CONSTRAINT chk_fares_amount   CHECK (amount_lkr >= 0)
) ENGINE=InnoDB;

CREATE TABLE application_windows (
  id         CHAR(36) NOT NULL DEFAULT (UUID()),
  month_for  DATE     NOT NULL,                   -- first day of the ticket month
  opens_on   DATE     NOT NULL,
  closes_on  DATE     NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_window_dates CHECK (closes_on >= opens_on)
) ENGINE=InnoDB;

-- ========== APPLICATIONS, PAYMENTS, TICKETS ==========
CREATE TABLE applications (
  id                       CHAR(36)      NOT NULL DEFAULT (UUID()),
  user_id                  CHAR(36)      NOT NULL,
  from_station_id          CHAR(36)      NOT NULL,
  to_station_id            CHAR(36)      NOT NULL,
  ticket_class             ENUM('first','second','third') NOT NULL,
  period                   ENUM('weekly','monthly','quarterly') NOT NULL,
  duration_months          TINYINT       NULL,    -- government: 1-3 months
  start_date               DATE          NOT NULL,
  fare_lkr                 DECIMAL(10,2) NOT NULL,
  status                   ENUM('draft','pending_institution_approval',
                                'approved_awaiting_payment','paid',
                                'rejected','cancelled') NOT NULL DEFAULT 'draft',
  institution_approved_by  CHAR(36)      NULL,
  institution_approved_at  DATETIME      NULL,
  rejection_reason         TEXT,
  created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_applications_user   (user_id, status),
  KEY idx_applications_status (status),
  CONSTRAINT fk_app_user   FOREIGN KEY (user_id)         REFERENCES users(id),
  CONSTRAINT fk_app_from   FOREIGN KEY (from_station_id) REFERENCES stations(id),
  CONSTRAINT fk_app_to     FOREIGN KEY (to_station_id)   REFERENCES stations(id),
  CONSTRAINT fk_app_inst_approver FOREIGN KEY (institution_approved_by) REFERENCES staff_users(id),
  CONSTRAINT chk_app_stations CHECK (from_station_id <> to_station_id),
  CONSTRAINT chk_app_duration CHECK (duration_months IS NULL OR duration_months BETWEEN 1 AND 3)
) ENGINE=InnoDB;

CREATE TABLE payments (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  application_id  CHAR(36)      NOT NULL,
  amount_lkr      DECIMAL(10,2) NOT NULL,
  status          ENUM('pending','success','failed','refunded') NOT NULL DEFAULT 'pending',
  gateway_ref     VARCHAR(255)  NULL,             -- sandbox token only, never card data
  paid_at         DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_ref (gateway_ref),
  KEY idx_payments_application (application_id),
  CONSTRAINT fk_pay_app FOREIGN KEY (application_id) REFERENCES applications(id)
) ENGINE=InnoDB;

CREATE TABLE season_tickets (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  application_id   CHAR(36)     NOT NULL,
  user_id          CHAR(36)     NOT NULL,
  from_station_id  CHAR(36)     NOT NULL,
  to_station_id    CHAR(36)     NOT NULL,
  ticket_class     ENUM('first','second','third') NOT NULL,
  valid_from       DATE         NOT NULL,
  valid_to         DATE         NOT NULL,
  signed_token     TEXT         NOT NULL,         -- signed payload shown as QR code
  status           ENUM('active','expired','revoked') NOT NULL DEFAULT 'active',
  issued_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_application (application_id),
  KEY idx_tickets_user_valid (user_id, valid_to),
  CONSTRAINT fk_tix_app  FOREIGN KEY (application_id)  REFERENCES applications(id),
  CONSTRAINT fk_tix_user FOREIGN KEY (user_id)         REFERENCES users(id),
  CONSTRAINT fk_tix_from FOREIGN KEY (from_station_id) REFERENCES stations(id),
  CONSTRAINT fk_tix_to   FOREIGN KEY (to_station_id)   REFERENCES stations(id),
  CONSTRAINT chk_tix_dates CHECK (valid_to >= valid_from)
) ENGINE=InnoDB;

CREATE TABLE ticket_scans (
  id            CHAR(36)    NOT NULL DEFAULT (UUID()),
  ticket_id     CHAR(36)    NOT NULL,
  inspector_id  CHAR(36)    NULL,
  result        ENUM('valid','expired','revoked','invalid') NOT NULL,
  scanned_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_scan_ticket    FOREIGN KEY (ticket_id)    REFERENCES season_tickets(id),
  CONSTRAINT fk_scan_inspector FOREIGN KEY (inspector_id) REFERENCES staff_users(id)
) ENGINE=InnoDB;

-- ========== AUDIT ==========
CREATE TABLE audit_logs (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  actor_user_id   CHAR(36)     NULL,
  actor_staff_id  CHAR(36)     NULL,
  action          VARCHAR(100) NOT NULL,
  entity          VARCHAR(100) NOT NULL,
  entity_id       CHAR(36)     NULL,
  details         JSON         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity, entity_id),
  CONSTRAINT fk_audit_user  FOREIGN KEY (actor_user_id)  REFERENCES users(id),
  CONSTRAINT fk_audit_staff FOREIGN KEY (actor_staff_id) REFERENCES staff_users(id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ========== ADDED FOR THE BACKEND: OTP LOGIN ==========
CREATE TABLE IF NOT EXISTS otp_codes (
  id          CHAR(36)     NOT NULL,
  phone       VARCHAR(15)  NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,
  expires_at  DATETIME     NOT NULL,
  attempts    TINYINT      NOT NULL DEFAULT 0,
  consumed_at DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_otp_phone (phone, created_at)
) ENGINE=InnoDB;
