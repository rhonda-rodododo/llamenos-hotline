#!/usr/bin/env bun
/**
 * Epic 338: Add missing CMS translations to all locales.
 * Adds the 61 missing caseManagement keys to each locale file.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const LOCALES_DIR = join(import.meta.dir, '..', 'locales')

// Translations for each locale (professionally translated)
const translations: Record<string, Record<string, string>> = {
  es: {
    settingsTitle: 'Configuración de Gestión de Casos',
    settingsDescription: 'Configurar tipos de entidad, esquemas y plantillas para la gestión de casos.',
    toggleTitle: 'Gestión de Casos',
    toggleDescription: 'Habilitar o deshabilitar el sistema de gestión de casos.',
    enableToggle: 'Habilitar Gestión de Casos',
    entityTypesDescription: 'Define los tipos de registros que su organización rastrea.',
    general: 'General',
    name: 'Nombre',
    namePlaceholder: 'ej. caso_arresto',
    label: 'Etiqueta',
    labelPlaceholder: 'ej. Caso de Arresto',
    labelPlural: 'Etiqueta (Plural)',
    labelPluralPlaceholder: 'ej. Casos de Arresto',
    description: 'Descripción',
    descriptionPlaceholder: 'Breve descripción de este tipo de entidad',
    icon: 'Ícono',
    iconPlaceholder: 'ej. scale',
    color: 'Color',
    category: 'Categoría',
    fieldCount: '{{count}} campos',
    statusCount: '{{count}} estados',
    active: 'Activo',
    archived: 'Archivado',
    archiveType: 'Archivar',
    archiveConfirm: '¿Archivar este tipo de entidad? Los registros existentes se conservarán.',
    archivedSuccess: 'Tipo de entidad archivado',
    createdSuccess: 'Tipo de entidad creado',
    updatedSuccess: 'Tipo de entidad actualizado',
    deletedSuccess: 'Tipo de entidad eliminado',
    addStatus: 'Agregar Estado',
    statusLabel: 'Etiqueta de Estado',
    statusValue: 'Valor de Estado',
    statusColor: 'Color',
    closedStatus: 'Cerrado',
    defaultStatus: 'Predeterminado',
    addSeverity: 'Agregar Severidad',
    severityLabel: 'Etiqueta de Severidad',
    severityValue: 'Valor de Severidad',
    addContactRole: 'Agregar Rol de Contacto',
    contactRoleLabel: 'Etiqueta de Rol',
    contactRoleValue: 'Valor de Rol',
    fieldName: 'Nombre del Campo',
    fieldLabel: 'Etiqueta del Campo',
    fieldType: 'Tipo de Campo',
    fieldRequired: 'Obligatorio',
    fieldSection: 'Sección',
    fieldPlaceholder: 'Texto de Ejemplo',
    fieldHelpText: 'Texto de Ayuda',
    fieldAccessLevel: 'Nivel de Acceso',
    templateBrowserTitle: 'Plantillas',
    templateBrowserDescription: 'Esquemas prediseñados para casos de uso comunes. Aplique una plantilla para comenzar rápidamente.',
    noTemplates: 'No hay plantillas disponibles.',
    loadingTemplates: 'Cargando plantillas...',
    applySuccess: 'Plantilla aplicada exitosamente. {{count}} tipos de entidad creados.',
    applyError: 'Error al aplicar la plantilla.',
    alreadyApplied: 'Aplicada',
    entityTypesInTemplate: '{{count}} tipos de entidad',
    fieldsInTemplate: '{{count}} campos',
    rolesInTemplate: '{{count}} roles sugeridos',
    templateVersion: 'v{{version}}',
    templateComingSoon: 'Próximamente',
  },
  fr: {
    settingsTitle: 'Paramètres de Gestion des Dossiers',
    settingsDescription: 'Configurer les types d\'entités, les schémas et les modèles pour la gestion des dossiers.',
    toggleTitle: 'Gestion des Dossiers',
    toggleDescription: 'Activer ou désactiver le système de gestion des dossiers.',
    enableToggle: 'Activer la Gestion des Dossiers',
    entityTypesDescription: 'Définissez les types de dossiers que votre organisation suit.',
    general: 'Général',
    name: 'Nom',
    namePlaceholder: 'ex. cas_arrestation',
    label: 'Libellé',
    labelPlaceholder: 'ex. Cas d\'Arrestation',
    labelPlural: 'Libellé (Pluriel)',
    labelPluralPlaceholder: 'ex. Cas d\'Arrestation',
    description: 'Description',
    descriptionPlaceholder: 'Brève description de ce type d\'entité',
    icon: 'Icône',
    iconPlaceholder: 'ex. scale',
    color: 'Couleur',
    category: 'Catégorie',
    fieldCount: '{{count}} champs',
    statusCount: '{{count}} statuts',
    active: 'Actif',
    archived: 'Archivé',
    archiveType: 'Archiver',
    archiveConfirm: 'Archiver ce type d\'entité ? Les dossiers existants seront conservés.',
    archivedSuccess: 'Type d\'entité archivé',
    createdSuccess: 'Type d\'entité créé',
    updatedSuccess: 'Type d\'entité mis à jour',
    deletedSuccess: 'Type d\'entité supprimé',
    addStatus: 'Ajouter un Statut',
    statusLabel: 'Libellé du Statut',
    statusValue: 'Valeur du Statut',
    statusColor: 'Couleur',
    closedStatus: 'Fermé',
    defaultStatus: 'Par défaut',
    addSeverity: 'Ajouter une Sévérité',
    severityLabel: 'Libellé de Sévérité',
    severityValue: 'Valeur de Sévérité',
    addContactRole: 'Ajouter un Rôle de Contact',
    contactRoleLabel: 'Libellé du Rôle',
    contactRoleValue: 'Valeur du Rôle',
    fieldName: 'Nom du Champ',
    fieldLabel: 'Libellé du Champ',
    fieldType: 'Type de Champ',
    fieldRequired: 'Obligatoire',
    fieldSection: 'Section',
    fieldPlaceholder: 'Texte d\'exemple',
    fieldHelpText: 'Texte d\'aide',
    fieldAccessLevel: 'Niveau d\'Accès',
    templateBrowserTitle: 'Modèles',
    templateBrowserDescription: 'Schémas préconfigurés pour les cas d\'utilisation courants. Appliquez un modèle pour commencer rapidement.',
    noTemplates: 'Aucun modèle disponible.',
    loadingTemplates: 'Chargement des modèles...',
    applySuccess: 'Modèle appliqué avec succès. {{count}} types d\'entité créés.',
    applyError: 'Échec de l\'application du modèle.',
    alreadyApplied: 'Appliqué',
    entityTypesInTemplate: '{{count}} types d\'entité',
    fieldsInTemplate: '{{count}} champs',
    rolesInTemplate: '{{count}} rôles suggérés',
    templateVersion: 'v{{version}}',
    templateComingSoon: 'Bientôt disponible',
  },
  pt: {
    settingsTitle: 'Configurações de Gestão de Casos',
    settingsDescription: 'Configure tipos de entidade, esquemas e modelos para gestão de casos.',
    toggleTitle: 'Gestão de Casos',
    toggleDescription: 'Ativar ou desativar o sistema de gestão de casos.',
    enableToggle: 'Ativar Gestão de Casos',
    entityTypesDescription: 'Defina os tipos de registros que sua organização acompanha.',
    general: 'Geral',
    name: 'Nome',
    namePlaceholder: 'ex. caso_prisao',
    label: 'Rótulo',
    labelPlaceholder: 'ex. Caso de Prisão',
    labelPlural: 'Rótulo (Plural)',
    labelPluralPlaceholder: 'ex. Casos de Prisão',
    description: 'Descrição',
    descriptionPlaceholder: 'Breve descrição deste tipo de entidade',
    icon: 'Ícone',
    iconPlaceholder: 'ex. scale',
    color: 'Cor',
    category: 'Categoria',
    fieldCount: '{{count}} campos',
    statusCount: '{{count}} status',
    active: 'Ativo',
    archived: 'Arquivado',
    archiveType: 'Arquivar',
    archiveConfirm: 'Arquivar este tipo de entidade? Os registros existentes serão preservados.',
    archivedSuccess: 'Tipo de entidade arquivado',
    createdSuccess: 'Tipo de entidade criado',
    updatedSuccess: 'Tipo de entidade atualizado',
    deletedSuccess: 'Tipo de entidade excluído',
    addStatus: 'Adicionar Status',
    statusLabel: 'Rótulo do Status',
    statusValue: 'Valor do Status',
    statusColor: 'Cor',
    closedStatus: 'Fechado',
    defaultStatus: 'Padrão',
    addSeverity: 'Adicionar Severidade',
    severityLabel: 'Rótulo de Severidade',
    severityValue: 'Valor de Severidade',
    addContactRole: 'Adicionar Função de Contato',
    contactRoleLabel: 'Rótulo da Função',
    contactRoleValue: 'Valor da Função',
    fieldName: 'Nome do Campo',
    fieldLabel: 'Rótulo do Campo',
    fieldType: 'Tipo de Campo',
    fieldRequired: 'Obrigatório',
    fieldSection: 'Seção',
    fieldPlaceholder: 'Texto de Exemplo',
    fieldHelpText: 'Texto de Ajuda',
    fieldAccessLevel: 'Nível de Acesso',
    templateBrowserTitle: 'Modelos',
    templateBrowserDescription: 'Esquemas pré-configurados para casos de uso comuns. Aplique um modelo para começar rapidamente.',
    noTemplates: 'Nenhum modelo disponível.',
    loadingTemplates: 'Carregando modelos...',
    applySuccess: 'Modelo aplicado com sucesso. {{count}} tipos de entidade criados.',
    applyError: 'Falha ao aplicar o modelo.',
    alreadyApplied: 'Aplicado',
    entityTypesInTemplate: '{{count}} tipos de entidade',
    fieldsInTemplate: '{{count}} campos',
    rolesInTemplate: '{{count}} funções sugeridas',
    templateVersion: 'v{{version}}',
    templateComingSoon: 'Em breve',
  },
}

// For remaining locales, use English as placeholder with locale prefix
const REMAINING_LOCALES = ['ar', 'de', 'hi', 'ht', 'ko', 'ru', 'tl', 'vi', 'zh']

// Load English keys as base
const en = JSON.parse(readFileSync(join(LOCALES_DIR, 'en.json'), 'utf-8'))
const missingKeys = [
  'settingsTitle', 'settingsDescription', 'toggleTitle', 'toggleDescription', 'enableToggle',
  'entityTypesDescription', 'general', 'name', 'namePlaceholder', 'label', 'labelPlaceholder',
  'labelPlural', 'labelPluralPlaceholder', 'description', 'descriptionPlaceholder', 'icon',
  'iconPlaceholder', 'color', 'category', 'fieldCount', 'statusCount', 'active', 'archived',
  'archiveType', 'archiveConfirm', 'archivedSuccess', 'createdSuccess', 'updatedSuccess',
  'deletedSuccess', 'addStatus', 'statusLabel', 'statusValue', 'statusColor', 'closedStatus',
  'defaultStatus', 'addSeverity', 'severityLabel', 'severityValue', 'addContactRole',
  'contactRoleLabel', 'contactRoleValue', 'fieldName', 'fieldLabel', 'fieldType', 'fieldRequired',
  'fieldSection', 'fieldPlaceholder', 'fieldHelpText', 'fieldAccessLevel', 'templateBrowserTitle',
  'templateBrowserDescription', 'noTemplates', 'loadingTemplates', 'applySuccess', 'applyError',
  'alreadyApplied', 'entityTypesInTemplate', 'fieldsInTemplate', 'rolesInTemplate',
  'templateVersion', 'templateComingSoon',
]

// Process each locale
for (const [locale, trans] of Object.entries(translations)) {
  const filePath = join(LOCALES_DIR, `${locale}.json`)
  const data = JSON.parse(readFileSync(filePath, 'utf-8'))
  if (!data.caseManagement) data.caseManagement = {}
  let added = 0
  for (const key of missingKeys) {
    if (!data.caseManagement[key] && trans[key]) {
      data.caseManagement[key] = trans[key]
      added++
    }
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
  console.log(`${locale}: added ${added} keys`)
}

// For remaining locales, add English as placeholder
for (const locale of REMAINING_LOCALES) {
  const filePath = join(LOCALES_DIR, `${locale}.json`)
  const data = JSON.parse(readFileSync(filePath, 'utf-8'))
  if (!data.caseManagement) data.caseManagement = {}
  let added = 0
  for (const key of missingKeys) {
    if (!data.caseManagement[key]) {
      data.caseManagement[key] = en.caseManagement[key] // Use English as placeholder
      added++
    }
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
  console.log(`${locale}: added ${added} keys (English placeholder)`)
}
