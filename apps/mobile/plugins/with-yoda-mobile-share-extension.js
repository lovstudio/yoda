/* global require, module, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const path = require('node:path');
const { withXcodeProject } = require('@expo/config-plugins');

const EXTENSION_DIRECTORY = 'YodaMobileShareExtension';
const EXTENSION_TARGET = 'YodaMobileShareExtension';
const EXTENSION_BUNDLE_IDENTIFIER = 'ai.lovstudio.yoda.mobile.share';

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

function writeExtensionFiles(config) {
  const nativeRoot = config.modRequest.platformProjectRoot;
  const extensionRoot = path.join(nativeRoot, EXTENSION_DIRECTORY);
  const templateRoot = path.join(__dirname, '..', 'native-share-extension');
  fs.mkdirSync(extensionRoot, { recursive: true });
  for (const fileName of ['Info.plist', 'ShareViewController.swift']) {
    fs.copyFileSync(path.join(templateRoot, fileName), path.join(extensionRoot, fileName));
  }
}

function updateBuildSettings(project, target, config) {
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
      INFOPLIST_FILE: `${EXTENSION_DIRECTORY}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: '15.1',
      MARKETING_VERSION: marketingVersion,
      PRODUCT_BUNDLE_IDENTIFIER: EXTENSION_BUNDLE_IDENTIFIER,
      PRODUCT_NAME: EXTENSION_TARGET,
      SKIP_INSTALL: 'YES',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
      VERSIONING_SYSTEM: 'apple-generic',
    };
  }
}

function addExtensionFiles(project, targetUuid, groupUuid) {
  if (!project.hasFile('ShareViewController.swift')) {
    project.addSourceFile(
      'ShareViewController.swift',
      { target: targetUuid, lastKnownFileType: 'sourcecode.swift' },
      groupUuid
    );
  }
  if (!project.hasFile('Info.plist')) {
    project.addFile('Info.plist', groupUuid, { lastKnownFileType: 'text.plist.xml' });
  }
}

function withYodaMobileShareExtension(config) {
  return withXcodeProject(config, (config) => {
    writeExtensionFiles(config);

    const project = config.modResults;
    let nativeTarget = findNativeTarget(project, EXTENSION_TARGET);
    if (!nativeTarget) {
      const created = project.addTarget(
        EXTENSION_TARGET,
        'app_extension',
        EXTENSION_DIRECTORY,
        EXTENSION_BUNDLE_IDENTIFIER
      );
      nativeTarget = { target: created.pbxNativeTarget, uuid: created.uuid };
    }

    const group = addRootGroup(project, EXTENSION_DIRECTORY);
    addExtensionFiles(project, nativeTarget.uuid, group.uuid);
    updateBuildSettings(project, nativeTarget.target, config);
    project.addTargetAttribute('CreatedOnToolsVersion', '1500', { uuid: nativeTarget.uuid });
    return config;
  });
}

module.exports = withYodaMobileShareExtension;
