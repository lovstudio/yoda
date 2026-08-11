import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private let markerPrefix = "YODA_MOBILE_SHARE|"
  private var didStartProcessing = false

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didStartProcessing else { return }
    didStartProcessing = true
    processInput()
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
      UIPasteboard.general.setItems(
        [[
          UTType.png.identifier: pngData,
          UTType.plainText.identifier: marker,
        ]],
        options: [.expirationDate: Date(timeIntervalSinceNow: 300)]
      )
      self.openHostApp(kind: "image", token: token, name: self.imageName(for: provider))
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
      UIPasteboard.general.setItems(
        [[UTType.plainText.identifier: "\(marker)\n\(text)"]],
        options: [.expirationDate: Date(timeIntervalSinceNow: 300)]
      )
      self.openHostApp(kind: "text", token: token, name: "共享文本.txt")
    }
  }

  private func imageName(for provider: NSItemProvider) -> String {
    let suggestedName = provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let suggestedName, !suggestedName.isEmpty else { return "截图.png" }
    return suggestedName
  }

  private func openHostApp(kind: String, token: String, name: String) {
    var components = URLComponents()
    components.scheme = "yodamobile"
    components.host = "share"
    components.queryItems = [
      URLQueryItem(name: "source", value: "share-extension"),
      URLQueryItem(name: "kind", value: kind),
      URLQueryItem(name: "token", value: token),
      URLQueryItem(name: "name", value: name),
    ]

    guard let url = components.url else {
      showError("分享链接生成失败，请重试。")
      return
    }

    DispatchQueue.main.async { [weak self] in
      self?.extensionContext?.open(url) { [weak self] opened in
        DispatchQueue.main.async {
          if opened {
            self?.extensionContext?.completeRequest(returningItems: nil)
          } else {
            self?.showError("Yoda Mobile 尚未打开，请先启动一次主 App 后重试。")
          }
        }
      }
    }
  }

  private func showError(_ message: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let alert = UIAlertController(title: "Yoda Mobile", message: message, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "完成", style: .default) { [weak self] _ in
        self?.extensionContext?.completeRequest(returningItems: nil)
      })
      self.present(alert, animated: true)
    }
  }
}
