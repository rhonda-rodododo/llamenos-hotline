variable "server_ip" {
  description = "Public IPv4 address of the provisioned server"
  type        = string
}

variable "server_name" {
  description = "Hostname of the server"
  type        = string
}

variable "domain" {
  description = "Domain name for the deployment"
  type        = string
}

variable "ansible_dir" {
  description = "Path to the Ansible playbooks directory, relative to the OpenTofu root. Set to empty string to skip inventory generation."
  type        = string
  default     = "../ansible"
}
