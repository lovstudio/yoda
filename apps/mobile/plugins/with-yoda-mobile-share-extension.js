/* global require, module, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const path = require('node:path');
const { withXcodeProject } = require('@expo/config-plugins');

const EXTENSIONS = [
  {
    directory: 'YodaMobileShareExtension',
    target: 'YodaMobileShareExtension',
    bundleIdentifier: 'ai.lovstudio.yoda.mobile.share',
    templateDirectory: 'native-share-extension',
    files: ['Info.plist', 'ShareViewController.swift'],
  },
  {
    directory: 'YodaMobileQuickActionExtension',
    target: 'YodaMobileQuickActionExtension',
    bundleIdentifier: 'ai.lovstudio.yoda.mobile.quick-action',
    templateDirectory: 'native-action-extension',
    files: ['Info.plist', 'ActionViewController.swift'],
  },
];

function unquote(value) {
  return typeof value === 'string' ? value.replace(/^"|"$/g, '') : value;
}

function findNativeTarget(project, name) {
  const targets = project.pbxNativeTargetSection();
  for (const [uuid, target] of Object.entries(targets)) {
    if (uuid.endsWith('_comment')) continue;
    if (unquote(target.name) === name) return { target, uuid };
  }
  return null;
}

function findGroup(project, name) {
  const groups = project.getPBXObject('PBXGroup');
  for (const [uuid, group] of Object.entries(groups)) {
    if (uuid.endsWith('_comment')) continue;
    if (unquote(group.name) === name || unquote(group.path) === name) return { group, uuid };
  }
  return null;
}

function addRootGroup(project, name) {
  const existing = findGroup(project, name);
  if (existing) return existing;

  const created = project.addPbxGroup([], name, name);
  const rootProject = project.getFirstProject().firstProject;
  const rootGroup = project.getPBXGroupByKey(rootProject.mainGroup);
  rootGroup.children.push({ value: created.uuid, comment: name });
  return { group: created.pbxGroup, uuid: created.uuid };
}

function writeExtensionFiles(config, extension) {
  const nativeRoot = config.modRequest.platformProjectRoot;
  const extensionRoot = path.join(nativeRoot, extension.directory);
  const templateRoot = path.join(__dirname, '..', extension.templateDirectory);
  fs.mkdirSync(extensionRoot, { recursive: true });
  for (const fileName of extension.files) {
    fs.copyFileSync(path.join(templateRoot, fileName), path.join(extensionRoot, fileName));
  }
}

function updateBuildSettings(project, target, config, extension) {
  const configurationList = project.pbxXCConfigurationList()[target.buildConfigurationList];
  if (!configurationList) return;

  const configurations = project.pbxXCBuildConfigurationSection();
  const buildNumber = config.ios?.buildNumber ?? '1';
  const marketingVersion = config.version ?? '1.0.0';
  for (const configuration of configurationList.buildConfigurations) {
    const buildConfiguration = configurations[configuration.value];
    if (!buildConfiguration) continue;
    buildConfiguration.buildSettings = {
      ...buildConfiguration.buildSettings,
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      CODE_SIGN_STYLE: 'Automatic',
      CURRENT_PROJECT_VERSION: buildNumber,
      DEVELOPMENT_TEAM: config.ios?.appleTeamId,
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${extension.directory}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: '15.1',
      MARKETING_VERSION: marketingVersion,
      PRODUCT_BUNDLE_IDENTIFIER: extension.bundleIdentifier,
      PRODUCT_NAME: extension.target,
      SKIP_INSTALL: 'YES',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
      VERSIONING_SYSTEM: 'apple-generic',
    };
  }
}

function ensureTargetBuildPhases(project, targetUuid) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const hasBuildPhase = (comment) =>
    Boolean(target?.buildPhases?.some((phase) => phase.comment === comment));

  if (!hasBuildPhase('Sources')) {
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
  }
  if (!hasBuildPhase('Resources')) {
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetUuid);
  }
  if (!hasBuildPhase('Frameworks')) {
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);
  }
}

function findFileReferenceUuid(project, fileName) {
  const files = project.pbxFileReferenceSection();
  for (const [uuid, file] of Object.entries(files)) {
    if (uuid.endsWith('_comment')) continue;
    if (unquote(file.path) === fileName || unquote(file.name) === fileName) return uuid;
  }
  return null;
}

function addExistingSourceToTarget(project, targetUuid, sourceFile) {
  const sources = project.pbxSourcesBuildPhaseObj(targetUuid);
  if (!sources || sources.files.some((file) => file.comment === `${sourceFile} in Sources`)) {
    return;
  }

  const fileRef = findFileReferenceUuid(project, sourceFile);
  if (!fileRef) return;

  const file = {
    basename: sourceFile,
    fileRef,
    group: 'Sources',
    uuid: project.generateUuid(),
  };
  project.addToPbxBuildFileSection(file);
  project.addToPbxSourcesBuildPhase(file);
}

function addExtensionFiles(project, targetUuid, groupUuid, extension) {
  const sourceFile = extension.files.find((fileName) => fileName.endsWith('.swift'));
  if (!sourceFile) throw new Error(`No Swift source configured for ${extension.target}`);

  if (!project.hasFile(sourceFile)) {
    project.addSourceFile(
      sourceFile,
      { target: targetUuid, lastKnownFileType: 'sourcecode.swift' },
      groupUuid
    );
  } else {
    addExistingSourceToTarget(project, targetUuid, sourceFile);
  }
  if (!project.hasFile('Info.plist')) {
    project.addFile('Info.plist', groupUuid, { lastKnownFileType: 'text.plist.xml' });
  }
}

function withYodaMobileShareExtension(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    for (const extension of EXTENSIONS) {
      writeExtensionFiles(config, extension);

      let nativeTarget = findNativeTarget(project, extension.target);
      if (!nativeTarget) {
        const created = project.addTarget(
          extension.target,
          'app_extension',
          extension.directory,
          extension.bundleIdentifier
        );
        nativeTarget = { target: created.pbxNativeTarget, uuid: created.uuid };
      }

      ensureTargetBuildPhases(project, nativeTarget.uuid);
      const group = addRootGroup(project, extension.directory);
      addExtensionFiles(project, nativeTarget.uuid, group.uuid, extension);
      updateBuildSettings(project, nativeTarget.target, config, extension);
      project.addTargetAttribute('CreatedOnToolsVersion', '1500', { uuid: nativeTarget.uuid });
    }
    return config;
  });
}

module.exports = withYodaMobileShareExtension;
