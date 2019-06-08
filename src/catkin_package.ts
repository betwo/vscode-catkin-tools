
import * as fs from 'fs';

export class CatkinPackage {
  public name: string;
  public path: string;
  public relative_path: fs.PathLike;

  public package_xml: string;

  public build_space?: fs.PathLike;

  public has_tests: boolean;
}
