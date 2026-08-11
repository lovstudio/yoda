import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private let markerPrefix = "YODA_MOBILE_SHARE|"
  private var didStartProcessing = false

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didStartProcessing else { return }
    didStartProcessing = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
      self?.processInput()
    }
  }

  private func processInput() {
    guard
      let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
      let provider = extensionItem.attachments?.first(where: {
        $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
          || $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
      })
    else {
      showError("当前内容暂不支持分享给 Yoda Mobile。")
      return
    }

    if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
      loadImage(from: provider)
    } else {
      loadText(from: provider)
    }
  }

  private func loadImage(from provider: NSItemProvider) {
    provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] data, error in
      guard let self else { return }
      guard let data, let image = UIImage(data: data), let pngData = image.pngData() else {
        self.showError(error?.localizedDescription ?? "图片读取失败，请重试。")
        return
      }

      let token = UUID().uuidString
      let marker = "\(self.markerPrefix)\(token)|image"
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        UIPasteboard.general.setItems(
          [[
            UTType.png.identifier: pngData,
            UTType.plainText.identifier: marker,
          ]],
          options: [.expirationDate: Date(timeIntervalSinceNow: 300)]
        )
        self.finishRequest()
      }
    }
  }

  private func loadText(from provider: NSItemProvider) {
    provider.loadDataRepresentation(forTypeIdentifier: UTType.plainText.identifier) { [weak self] data, error in
      guard let self else { return }
      guard let data, let text = String(data: data, encoding: .utf8) else {
        self.showError(error?.localizedDescription ?? "文字读取失败，请重试。")
        return
      }

      let token = UUID().uuidString
      let marker = "\(self.markerPrefix)\(token)|text"
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        UIPasteboard.general.setItems(
          [[UTType.plainText.identifier: "\(marker)\n\(text)"]],
          options: [.expirationDate: Date(timeIntervalSinceNow: 300)]
        )
        self.finishRequest()
      }
    }
  }

  private func finishRequest() {
    DispatchQueue.main.async { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
  }

  private func showError(_ message: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let alert = UIAlertController(title: "Yoda Mobile", message: message, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "完成", style: .default) { [weak self] _ in
        self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
      })
      self.present(alert, animated: true)
    }
  }
}
