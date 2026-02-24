# Llamenos Infrastructure — Root Module
#
# Provisions a Hetzner Cloud VPS and generates an Ansible inventory
# for subsequent configuration management.
#
# Usage:
#   cd deploy/opentofu
#   tofu init
#   tofu plan -var="hcloud_token=YOUR_TOKEN" -var="domain=hotline.example.org"
#   tofu apply -var="hcloud_token=YOUR_TOKEN" -var="domain=hotline.example.org"
#
# Or with a .tfvars file:
#   cp terraform.tfvars.example terraform.tfvars  # edit values
#   tofu apply

module "hetzner" {
  source = "./modules/hetzner"

  ssh_public_key_path = var.ssh_public_key_path
  server_type         = var.server_type
  location            = var.location
  server_name         = var.server_name
  image               = var.image
  domain              = var.domain
  enable_backups      = var.enable_backups
}

module "inventory" {
  source = "./modules/generic"

  server_ip   = module.hetzner.server_ip
  server_name = module.hetzner.server_name
  domain      = var.domain
  ansible_dir = var.ansible_dir
}
