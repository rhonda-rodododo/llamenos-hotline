variable "ssh_public_key_path" {
  description = "Path to the SSH public key to upload to Hetzner Cloud"
  type        = string
}

variable "server_type" {
  description = "Hetzner Cloud server type"
  type        = string
}

variable "location" {
  description = "Hetzner Cloud datacenter location"
  type        = string
}

variable "server_name" {
  description = "Hostname for the server"
  type        = string
}

variable "image" {
  description = "Hetzner Cloud OS image"
  type        = string
}

variable "domain" {
  description = "Domain name for the deployment"
  type        = string
}

variable "enable_backups" {
  description = "Enable automated Hetzner Cloud backups"
  type        = bool
  default     = true
}
